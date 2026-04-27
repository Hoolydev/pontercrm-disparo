import { schema } from "@pointer/db";
import { newId } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";

const triggerBody = z.object({
  name: z.string().min(1),
  patternType: z.enum(["keyword", "regex", "llm_classifier", "tool_call"]),
  pattern: z.string().default(""),
  action: z.enum(["assign_broker", "pause_ai", "notify"]).default("pause_ai"),
  priority: z.number().int().min(1).max(1000).default(100),
  agentId: z.string().uuid().nullable().optional()
});

export async function registerTriggers(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole("admin")] };
  const authGuard = { preHandler: [app.authenticate] };

  app.get("/handoff-triggers", authGuard, async () => {
    const db = getDb();
    return { triggers: await db.query.handoffTriggers.findMany({ orderBy: (t, { asc }) => [asc(t.priority)] }) };
  });

  app.post("/handoff-triggers", adminGuard, async (req, reply) => {
    const body = triggerBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();
    const id = newId();
    await db.insert(schema.handoffTriggers).values({ id, ...body.data });
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>("/handoff-triggers/:id", adminGuard, async (req, reply) => {
    const body = triggerBody.partial().safeParse(req.body);
    if (!body.success) return reply.badRequest();
    const db = getDb();
    await db.update(schema.handoffTriggers).set(body.data).where(eq(schema.handoffTriggers.id, req.params.id));
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>("/handoff-triggers/:id/toggle", adminGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.handoffTriggers.findFirst({ where: eq(schema.handoffTriggers.id, req.params.id) });
    if (!row) return reply.notFound();
    await db.update(schema.handoffTriggers).set({ active: !row.active }).where(eq(schema.handoffTriggers.id, row.id));
    return { ok: true, active: !row.active };
  });

  app.delete<{ Params: { id: string } }>("/handoff-triggers/:id", adminGuard, async (req, reply) => {
    const db = getDb();
    await db.delete(schema.handoffTriggers).where(eq(schema.handoffTriggers.id, req.params.id));
    return reply.code(204).send();
  });
}
