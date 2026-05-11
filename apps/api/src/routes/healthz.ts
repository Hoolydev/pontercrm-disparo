import { schema } from "@pointer/db";
import { desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

export async function registerHealthz(app: FastifyInstance) {
  app.get("/healthz", async () => ({ ok: true, service: "api", ts: new Date().toISOString() }));

  app.get("/readyz", async (_req, reply) => {
    try {
      const db = getDb();
      await db.execute(sql`select 1`);
      return { ok: true, db: "up" };
    } catch (err) {
      app.log.error({ err }, "readyz db check failed");
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });

  // ─── Webhook diagnostic (admin-only) ──────────────────────────────────────
  // GET /diag/webhooks — returns the last 30 webhook_events so you can see
  // what's arriving (or not arriving) from the Meta Cloud API.
  app.get(
    "/diag/webhooks",
    { preHandler: [app.authenticate, app.requireRole("admin")] },
    async () => {
      const db = getDb();
      const events = await db.query.webhookEvents.findMany({
        orderBy: [desc(schema.webhookEvents.createdAt)],
        limit: 30
      });

      const summary = {
        total: events.length,
        wa_messages: events.filter(e => e.dedupeKey.startsWith("wa:") && !e.dedupeKey.startsWith("wa-ignored:")).length,
        wa_ignored: events.filter(e => e.dedupeKey.startsWith("wa-ignored:")).length,
        lead_portal: events.filter(e => e.dedupeKey.startsWith("lead:")).length
      };

      return {
        summary,
        events: events.map(e => ({
          id: e.id,
          provider: e.provider,
          dedupeKey: e.dedupeKey,
          createdAt: e.createdAt,
          // Show first 800 chars of payload for ignored events only
          payload: e.dedupeKey.startsWith("wa-ignored:")
            ? JSON.stringify(e.rawPayload).slice(0, 800)
            : undefined
        }))
      };
    }
  );
}

