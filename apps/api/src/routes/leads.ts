import { createBrokerFollowups, recordBrokerAssignment } from "@pointer/agent-engine";
import { schema } from "@pointer/db";
import { newId, normalizeE164 } from "@pointer/shared";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { pickBroker } from "../lib/round-robin.js";
import { resolveDefaultStageId } from "../lib/pipeline.js";

export async function registerLeads(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  // GET /leads?stageId=&search=&brokerId=&campaignId=&page=
  app.get<{
    Querystring: {
      stageId?: string;
      search?: string;
      brokerId?: string;
      campaignId?: string;
      page?: string;
      limit?: string;
    };
  }>("/leads", auth, async (req) => {
    const { stageId, search, brokerId, campaignId, page = "1", limit: rawLimit } = req.query;
    const { sub: userId, role } = req.user;
    const db = getDb();
    const requested = rawLimit ? parseInt(rawLimit, 10) : 50;
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 50, 1), 5000);
    const offset = (parseInt(page, 10) - 1) * limit;

    const conditions = [];
    if (stageId) conditions.push(eq(schema.leads.pipelineStageId, stageId));
    if (search) {
      conditions.push(
        or(
          ilike(schema.leads.name, `%${search}%`),
          ilike(schema.leads.phone, `%${search}%`),
          ilike(schema.leads.email, `%${search}%`)
        )!
      );
    }
    if (brokerId) {
      conditions.push(eq(schema.leads.assignedBrokerId, brokerId));
    } else if (role === "broker") {
      const broker = await db.query.brokers.findFirst({
        where: eq(schema.brokers.userId, userId)
      });
      if (broker) conditions.push(eq(schema.leads.assignedBrokerId, broker.id));
    }

    if (campaignId) {
      // Restrict to leads that belong to this campaign via campaign_leads.
      const inCampaign = await db
        .select({ id: schema.campaignLeads.leadId })
        .from(schema.campaignLeads)
        .where(eq(schema.campaignLeads.campaignId, campaignId));
      const ids = inCampaign.map((r) => r.id);
      if (ids.length === 0) {
        return { leads: [], page: parseInt(page, 10), limit };
      }
      conditions.push(inArray(schema.leads.id, ids));
    }

    const rows = await db.query.leads.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [desc(schema.leads.createdAt)],
      limit,
      offset,
      with: {
        source: { columns: { id: true, name: true, type: true } },
        assignedBroker: { columns: { id: true, displayName: true } },
        pipelineStage: { columns: { id: true, name: true, category: true, color: true } }
      }
    });

    return { leads: rows, page: parseInt(page, 10), limit };
  });

  app.get<{ Params: { id: string } }>("/leads/:id", auth, async (req, reply) => {
    const db = getDb();
    const lead = await db.query.leads.findFirst({
      where: eq(schema.leads.id, req.params.id),
      with: {
        source: true,
        assignedBroker: { columns: { id: true, displayName: true } },
        pipelineStage: true,
        conversations: {
          orderBy: [desc(schema.conversations.createdAt)],
          limit: 5,
          columns: {
            id: true,
            status: true,
            aiPaused: true,
            lastMessageAt: true,
            createdAt: true
          }
        }
      }
    });
    if (!lead) return reply.notFound();
    return { lead };
  });

  app.post("/leads", auth, async (req, reply) => {
    const body = z
      .object({
        name: z.string().optional(),
        phone: z.string().min(8),
        email: z.string().email().optional(),
        sourceId: z.string().uuid(),
        origin: z.string().optional(),
        propertyRef: z.string().optional(),
        brokerId: z.string().uuid().optional(),
        pipelineStageId: z.string().uuid().optional()
      })
      .safeParse(req.body);
    if (!body.success) return reply.badRequest();

    const db = getDb();
    const phone = normalizeE164(body.data.phone);
    const brokerId = body.data.brokerId ?? (await pickBroker(db)) ?? undefined;
    const stageId = body.data.pipelineStageId ?? (await resolveDefaultStageId(db));

    const id = newId();
    await db.insert(schema.leads).values({
      id,
      sourceId: body.data.sourceId,
      name: body.data.name,
      phone,
      email: body.data.email,
      origin: body.data.origin,
      propertyRef: body.data.propertyRef,
      assignedBrokerId: brokerId,
      pipelineStageId: stageId,
      metadataJson: { manual: true }
    });

    return reply.code(201).send({ id });
  });

  // PATCH /leads/:id/stage
  app.patch<{ Params: { id: string } }>("/leads/:id/stage", auth, async (req, reply) => {
    const body = z.object({ stageId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.badRequest();

    const db = getDb();
    const stage = await db.query.pipelineStages.findFirst({
      where: eq(schema.pipelineStages.id, body.data.stageId)
    });
    if (!stage) return reply.badRequest("invalid stageId");

    await db
      .update(schema.leads)
      .set({ pipelineStageId: body.data.stageId })
      .where(eq(schema.leads.id, req.params.id));
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>(
    "/leads/:id/assign",
    { preHandler: [app.authenticate, app.requireRole("admin", "supervisor")] },
    async (req, reply) => {
      const body = z.object({ brokerId: z.string().uuid().nullable() }).safeParse(req.body);
      if (!body.success) return reply.badRequest();

      const db = getDb();
      await db
        .update(schema.leads)
        .set({ assignedBrokerId: body.data.brokerId ?? undefined })
        .where(eq(schema.leads.id, req.params.id));

      if (body.data.brokerId) {
        await db
          .update(schema.conversations)
          .set({ assignedBrokerId: body.data.brokerId })
          .where(
            and(
              eq(schema.conversations.leadId, req.params.id),
              eq(schema.conversations.status, "ai_active")
            )
          );

        // Wire deterministic engines: every broker assignment gets a queue row
        // (with timeout) + cobrança chain.
        const conv = await db.query.conversations.findFirst({
          where: and(
            eq(schema.conversations.leadId, req.params.id),
            eq(schema.conversations.status, "ai_active")
          ),
          columns: { id: true, campaignId: true }
        });
        await recordBrokerAssignment(db, {
          leadId: req.params.id,
          brokerId: body.data.brokerId,
          conversationId: conv?.id ?? null,
          reason: "manual_assign"
        });
        if (conv) {
          await createBrokerFollowups(db, {
            leadId: req.params.id,
            conversationId: conv.id,
            campaignId: conv.campaignId ?? null,
            brokerId: body.data.brokerId,
            triggerEvent: "manual_assign"
          });
        }
      }

      return { ok: true };
    }
  );
}
