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
}
