import { schema } from "@pointer/db";
import { newId } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";

const ADMIN_ONLY = { preHandler: [] as any[] }; // populated after auth plugin

function newSecret() {
  return randomBytes(32).toString("hex");
}

const bodySchema = z.object({
  type: z.string().min(1).max(64),
  name: z.string().min(1).max(128)
});

export async function registerLeadSources(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole("admin")] };

  // GET /lead-sources
  app.get("/lead-sources", { preHandler: [app.authenticate] }, async () => {
    const db = getDb();
    const rows = await db.query.leadSources.findMany();
    return { sources: rows };
  });

  // POST /lead-sources
  app.post("/lead-sources", adminGuard, async (req, reply) => {
    const body = bodySchema.safeParse(req.body);
    if (!body.success) return reply.badRequest();

    const db = getDb();
    const id = newId();
    const secret = newSecret();

    await db.insert(schema.leadSources).values({
      id,
      type: body.data.type,
      name: body.data.name,
      webhookSecret: secret,
      active: true,
      configJson: {}
    });

    const apiUrl = process.env.API_URL ?? "http://localhost:3333";
    return reply.code(201).send({
      id,
      webhookUrl: `${apiUrl}/webhooks/leads/${id}`,
      webhookSecret: secret
    });
  });

  // GET /lead-sources/:id
  app.get<{ Params: { id: string } }>(
    "/lead-sources/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const db = getDb();
      const row = await db.query.leadSources.findFirst({
        where: eq(schema.leadSources.id, req.params.id)
      });
      if (!row) return reply.notFound();
      const apiUrl = process.env.API_URL ?? "http://localhost:3333";
      return {
        ...row,
        webhookUrl: `${apiUrl}/webhooks/leads/${row.id}`
      };
    }
  );

  // PATCH /lead-sources/:id/toggle — activate / deactivate
  app.patch<{ Params: { id: string } }>(
    "/lead-sources/:id/toggle",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const row = await db.query.leadSources.findFirst({
        where: eq(schema.leadSources.id, req.params.id)
      });
      if (!row) return reply.notFound();
      await db
        .update(schema.leadSources)
        .set({ active: !row.active })
        .where(eq(schema.leadSources.id, row.id));
      return { ok: true, active: !row.active };
    }
  );

  // POST /lead-sources/:id/regen-secret
  app.post<{ Params: { id: string } }>(
    "/lead-sources/:id/regen-secret",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const row = await db.query.leadSources.findFirst({
        where: eq(schema.leadSources.id, req.params.id)
      });
      if (!row) return reply.notFound();
      const secret = newSecret();
      await db
        .update(schema.leadSources)
        .set({ webhookSecret: secret })
        .where(eq(schema.leadSources.id, row.id));
      return { ok: true, webhookSecret: secret };
    }
  );

  // DELETE /lead-sources/:id
  app.delete<{ Params: { id: string } }>(
    "/lead-sources/:id",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      await db
        .delete(schema.leadSources)
        .where(eq(schema.leadSources.id, req.params.id));
      return reply.code(204).send();
    }
  );
}
