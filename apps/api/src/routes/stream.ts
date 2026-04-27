import { schema } from "@pointer/db";
import type { Role } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { CH } from "../lib/events.js";
import { getDb } from "../db.js";

export async function registerStream(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>(
    "/stream/inbox",
    async (req, reply) => {
      // EventSource cannot set Authorization headers, so accept token via query param
      const rawToken = req.query.token ?? req.headers.authorization?.replace("Bearer ", "");
      if (!rawToken) return reply.unauthorized();

      let user: { sub: string; role: Role };
      try {
        user = app.jwt.verify<{ sub: string; role: Role }>(rawToken);
      } catch {
        return reply.unauthorized();
      }

      const db = getDb();
      let brokerId: string | null = null;
      if (user.role === "broker") {
        const broker = await db.query.brokers.findFirst({
          where: eq(schema.brokers.userId, user.sub)
        });
        if (!broker) return reply.forbidden("no broker profile");
        brokerId = broker.id;
      }

      const subscriber = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.raw.flushHeaders();

      const sendEvent = (payload: object) => {
        if (reply.raw.destroyed) return;
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      await subscriber.subscribe(CH.inbox);
      subscriber.on("message", (_ch: string, raw: string) => {
        try {
          const evt = JSON.parse(raw) as { brokerId?: string; [k: string]: unknown };
          if (brokerId && evt.brokerId && evt.brokerId !== brokerId) return;
          sendEvent(evt);
        } catch {}
      });

      const hb = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(`: heartbeat\n\n`);
      }, 25_000);

      req.raw.on("close", () => {
        clearInterval(hb);
        subscriber.disconnect();
      });

      await new Promise<void>((res) => req.raw.on("close", res));
    }
  );
}
