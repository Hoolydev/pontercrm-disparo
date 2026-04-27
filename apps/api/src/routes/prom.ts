import { getQueues } from "@pointer/queue";
import type { FastifyInstance } from "fastify";
import { buildPromExposition } from "../lib/prom.js";
import { getDb } from "../db.js";

/**
 * Prometheus scrape endpoint.
 *
 * Auth options:
 *   1. Internal-only: only callable from Prometheus inside our network. We
 *      gate via the `PROM_AUTH_TOKEN` env var (sent as Bearer). If the var
 *      is unset, the endpoint refuses on principle — explicit opt-in.
 *
 * Scrape interval recommended: 30s. Pulling-from-DB is ~few queries; should
 * stay under 200ms even on Neon free tier.
 */
export async function registerPromMetrics(app: FastifyInstance) {
  app.get("/internal/metrics", async (req, reply) => {
    const expected = process.env.PROM_AUTH_TOKEN;
    if (!expected) {
      return reply.code(503).send("PROM_AUTH_TOKEN not configured");
    }
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${expected}`) {
      return reply.code(401).send("unauthorized");
    }

    try {
      const text = await buildPromExposition(getDb(), getQueues());
      reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
      return reply.send(text);
    } catch (err) {
      req.log.error({ err }, "prom: scrape failed");
      return reply.code(500).send("scrape_failed");
    }
  });
}
