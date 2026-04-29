import { cancelPendingFollowups, markBrokerAccepted } from "@pointer/agent-engine";
import { schema } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { newId, sha256 } from "@pointer/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";

export async function registerConversations(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  // GET /conversations?limit=
  app.get<{ Querystring: { limit?: string } }>("/conversations", auth, async (req) => {
    const { sub: userId, role } = req.user;
    const db = getDb();

    let brokerId: string | null = null;
    if (role === "broker") {
      const broker = await db.query.brokers.findFirst({
        where: eq(schema.brokers.userId, userId)
      });
      brokerId = broker?.id ?? null;
    }

    const requested = req.query.limit ? parseInt(req.query.limit, 10) : 60;
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 60, 1), 5000);

    const rows = await db.query.conversations.findMany({
      where: brokerId ? eq(schema.conversations.assignedBrokerId, brokerId) : undefined,
      orderBy: [desc(schema.conversations.lastMessageAt)],
      limit,
      with: {
        lead: {
          columns: { id: true, name: true, phone: true, pipelineStageId: true },
          with: {
            pipelineStage: {
              columns: { id: true, name: true, category: true, color: true }
            }
          }
        },
        assignedBroker: { columns: { id: true, displayName: true } },
        campaign: { columns: { id: true, name: true, status: true } },
        messages: {
          orderBy: [desc(schema.messages.createdAt)],
          limit: 1,
          columns: { id: true, content: true, senderType: true, createdAt: true }
        }
      }
    });

    return { conversations: rows };
  });

  // GET /conversations/:id
  app.get<{ Params: { id: string } }>("/conversations/:id", auth, async (req, reply) => {
    const db = getDb();
    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, req.params.id),
      with: {
        lead: {
          with: {
            pipelineStage: {
              columns: { id: true, name: true, category: true, color: true }
            }
          }
        },
        assignedBroker: { columns: { id: true, displayName: true } },
        agent: { columns: { id: true, name: true, model: true, type: true } },
        campaign: { columns: { id: true, name: true, status: true, pipelineId: true } },
        messages: {
          orderBy: [desc(schema.messages.createdAt)],
          limit: 60
        }
      }
    });
    if (!conv) return reply.notFound();
    return { conversation: conv };
  });

  // POST /conversations/:id/messages — broker manual send
  app.post<{ Params: { id: string } }>(
    "/conversations/:id/messages",
    auth,
    async (req, reply) => {
      const body = z.object({ text: z.string().min(1).max(4096) }).safeParse(req.body);
      if (!body.success) return reply.badRequest();

      const { sub: userId, role } = req.user;
      const db = getDb();

      const conv = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, req.params.id)
      });
      if (!conv) return reply.notFound();

      if (role === "broker") {
        const broker = await db.query.brokers.findFirst({
          where: eq(schema.brokers.userId, userId)
        });
        if (conv.assignedBrokerId !== broker?.id) return reply.forbidden();
      }

      const msgId = newId();
      const contentHash = sha256(body.data.text);

      await db.insert(schema.messages).values({
        id: msgId,
        conversationId: conv.id,
        direction: "out",
        senderType: "broker",
        instanceId: conv.whatsappInstanceId ?? undefined,
        content: body.data.text,
        contentHash,
        status: "queued"
      });

      await db
        .update(schema.conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.conversations.id, conv.id));

      // Broker just responded — short-circuit the cobrança chain and mark
      // the queue row as accepted. Idempotent.
      await markBrokerAccepted(db, conv.id);
      await cancelPendingFollowups(db, conv.id, "broker_responded");

      await getQueues().outboundMessage.add(`broker-send:${msgId}`, {
        messageId: msgId,
        conversationId: conv.id
      });

      return reply.code(201).send({ messageId: msgId });
    }
  );

  // POST /conversations/:id/takeover
  app.post<{ Params: { id: string } }>(
    "/conversations/:id/takeover",
    auth,
    async (req, reply) => {
      const { sub: userId, role } = req.user;
      const db = getDb();

      const conv = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, req.params.id)
      });
      if (!conv) return reply.notFound();

      let assignBrokerId = conv.assignedBrokerId;
      if (role === "broker") {
        const broker = await db.query.brokers.findFirst({
          where: eq(schema.brokers.userId, userId)
        });
        if (!broker) return reply.forbidden("no broker profile");
        assignBrokerId = broker.id;
      }

      await db
        .update(schema.conversations)
        .set({
          aiPaused: true,
          status: "handed_off",
          assignedBrokerId: assignBrokerId ?? undefined
        })
        .where(eq(schema.conversations.id, conv.id));

      return { ok: true };
    }
  );

  // GET /conversations/:id/actions — IA action log + follow-up timeline
  app.get<{ Params: { id: string } }>(
    "/conversations/:id/actions",
    auth,
    async (req, reply) => {
      const db = getDb();
      const conv = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, req.params.id),
        columns: { id: true }
      });
      if (!conv) return reply.notFound();

      const [tools, followups] = await Promise.all([
        db.query.toolExecutions.findMany({
          where: eq(schema.toolExecutions.conversationId, req.params.id),
          orderBy: (t, { desc }) => [desc(t.createdAt)],
          limit: 100
        }),
        db.query.leadFollowups.findMany({
          where: eq(schema.leadFollowups.conversationId, req.params.id),
          orderBy: (f, { asc }) => [asc(f.scheduledFor)],
          limit: 100
        })
      ]);

      return {
        actions: {
          tools: tools.map((t) => ({
            id: t.id,
            toolName: t.toolName,
            arguments: t.argumentsJson,
            result: t.resultJson ?? null,
            status: t.status,
            error: t.error,
            createdAt: t.createdAt
          })),
          followups: followups.map((f) => ({
            id: f.id,
            step: f.step,
            status: f.status,
            scheduledFor: f.scheduledFor,
            triggerEvent: f.triggerEvent,
            result: f.resultJson ?? null,
            createdAt: f.createdAt
          }))
        }
      };
    }
  );

  // POST /conversations/:id/release
  app.post<{ Params: { id: string } }>(
    "/conversations/:id/release",
    auth,
    async (req, reply) => {
      const db = getDb();
      const conv = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, req.params.id)
      });
      if (!conv) return reply.notFound();

      await db
        .update(schema.conversations)
        .set({ aiPaused: false, status: "ai_active", handoffReason: null })
        .where(eq(schema.conversations.id, conv.id));

      return { ok: true };
    }
  );
}
