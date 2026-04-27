import { createAgentEngine } from "@pointer/agent-engine";
import { schema } from "@pointer/db";
import type { AgentType } from "@pointer/shared";
import { newId } from "@pointer/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { z } from "zod";
import { getDb } from "../db.js";
import { getStorage } from "../lib/storage.js";
import { saveMultipartFile } from "../lib/upload-helper.js";

const behaviorSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_history_messages: z.number().int().min(1).max(50).optional(),
  delay_range_ms: z.tuple([z.number(), z.number()]).optional(),
  summarize_after_messages: z.number().int().min(5).optional(),
  tools_enabled: z.array(z.string()).optional(),
  outbound_attachments: z
    .array(
      z.object({
        kind: z.enum(["image", "video", "document"]),
        url: z.string().url(),
        caption_template: z.string().optional()
      })
    )
    .optional()
});

const agentBody = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(["inbound", "outbound"]),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  behaviorJson: behaviorSchema.optional().default({}),
  firstMessage: z.string().nullable().optional(),
  handoffAgentId: z.string().nullable().optional(),
  flowJson: z.unknown().optional()
});

export async function registerAgents(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole("admin")] };
  const authGuard = { preHandler: [app.authenticate] };

  app.get<{ Querystring: { type?: string; active?: string } }>(
    "/agents",
    authGuard,
    async (req) => {
      const db = getDb();
      const { type, active } = req.query;
      const where = [];
      if (type === "inbound" || type === "outbound") {
        where.push(eq(schema.agents.type, type as AgentType));
      }
      if (active === "true" || active === "false") {
        where.push(eq(schema.agents.active, active === "true"));
      }
      return {
        agents: await db.query.agents.findMany({
          where: where.length ? and(...where) : undefined
        })
      };
    }
  );

  app.post("/agents", adminGuard, async (req, reply) => {
    const body = agentBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();
    const id = newId();
    await db.insert(schema.agents).values({ id, ...body.data });
    return reply.code(201).send({ id });
  });

  app.get<{ Params: { id: string } }>("/agents/:id", authGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.agents.findFirst({
      where: eq(schema.agents.id, req.params.id)
    });
    if (!row) return reply.notFound();
    return { agent: row };
  });

  app.patch<{ Params: { id: string } }>("/agents/:id", adminGuard, async (req, reply) => {
    const body = agentBody.partial().safeParse(req.body);
    if (!body.success) return reply.badRequest();
    const db = getDb();
    await db.update(schema.agents).set(body.data).where(eq(schema.agents.id, req.params.id));
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>("/agents/:id/toggle", adminGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.agents.findFirst({ where: eq(schema.agents.id, req.params.id) });
    if (!row) return reply.notFound();
    await db
      .update(schema.agents)
      .set({ active: !row.active })
      .where(eq(schema.agents.id, row.id));
    return { ok: true, active: !row.active };
  });

  app.delete<{ Params: { id: string } }>("/agents/:id", adminGuard, async (req, reply) => {
    const db = getDb();
    await db.delete(schema.agents).where(eq(schema.agents.id, req.params.id));
    return reply.code(204).send();
  });

  // ── Attachments ──────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/agents/:id/attachments",
    authGuard,
    async (req) => {
      const db = getDb();
      const rows = await db.query.agentAttachments.findMany({
        where: eq(schema.agentAttachments.agentId, req.params.id),
        orderBy: [desc(schema.agentAttachments.createdAt)]
      });
      return { attachments: rows };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/agents/:id/attachments",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const exists = await db.query.agents.findFirst({
        where: eq(schema.agents.id, req.params.id),
        columns: { id: true }
      });
      if (!exists) return reply.notFound();

      const file = await req.file();
      if (!file) return reply.badRequest("missing file");

      const caption =
        typeof file.fields.caption === "object" && "value" in file.fields.caption
          ? String((file.fields.caption as { value: unknown }).value ?? "")
          : null;

      let saved;
      try {
        saved = await saveMultipartFile({
          file,
          entityType: "agent",
          entityId: req.params.id
        });
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }

      const id = newId();
      await db.insert(schema.agentAttachments).values({
        id,
        agentId: req.params.id,
        kind: saved.kind,
        filename: saved.stored.filename,
        mimeType: saved.stored.mimeType,
        sizeBytes: saved.stored.size,
        storagePath: saved.stored.storagePath,
        url: saved.stored.url,
        caption: caption || null
      });

      return reply.code(201).send({
        id,
        kind: saved.kind,
        url: saved.stored.url,
        filename: saved.stored.filename,
        sizeBytes: saved.stored.size
      });
    }
  );

  app.delete<{ Params: { id: string; attId: string } }>(
    "/agents/:id/attachments/:attId",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const row = await db.query.agentAttachments.findFirst({
        where: and(
          eq(schema.agentAttachments.id, req.params.attId),
          eq(schema.agentAttachments.agentId, req.params.id)
        )
      });
      if (!row) return reply.notFound();
      await getStorage().delete(row.storagePath).catch(() => void 0);
      await db
        .delete(schema.agentAttachments)
        .where(eq(schema.agentAttachments.id, req.params.attId));
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string } }>("/agents/:id/playground", authGuard, async (req, reply) => {
    const body = z
      .object({
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
          .min(1)
      })
      .safeParse(req.body);
    if (!body.success) return reply.badRequest();

    const db = getDb();
    const exists = await db.query.agents.findFirst({
      where: eq(schema.agents.id, req.params.id),
      columns: { id: true }
    });
    if (!exists) return reply.notFound();

    // Preview is read-only — no SSE writes happen, but the engine signature
    // requires a Redis publisher; provide a lazy connection scoped to this request.
    const publisher = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    try {
      const engine = createAgentEngine({ db, publisher, logger: req.log });
      const res = await engine.preview({
        agentId: req.params.id,
        messages: body.data.messages
      });
      return { content: res.content, toolCalls: res.toolCalls, usage: res.usage };
    } catch (err) {
      return reply.internalServerError((err as Error).message);
    } finally {
      publisher.disconnect();
    }
  });
}
