import { schema } from "@pointer/db";
import { and, count, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

export async function registerNotifications(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get<{ Querystring: { unread?: string; limit?: string } }>(
    "/notifications",
    auth,
    async (req) => {
      const db = getDb();
      const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);

      const conditions = [eq(schema.notifications.userId, req.user.sub)];
      if (req.query.unread === "true") conditions.push(eq(schema.notifications.read, false));

      const rows = await db.query.notifications.findMany({
        where: and(...conditions),
        orderBy: [desc(schema.notifications.createdAt)],
        limit
      });

      const [unreadCount] = await db
        .select({ n: count() })
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, req.user.sub),
            eq(schema.notifications.read, false)
          )
        );

      return {
        notifications: rows,
        unreadCount: Number(unreadCount?.n ?? 0)
      };
    }
  );

  app.post<{ Params: { id: string } }>("/notifications/:id/read", auth, async (req, reply) => {
    const db = getDb();
    const result = await db
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.id, req.params.id),
          eq(schema.notifications.userId, req.user.sub)
        )
      )
      .returning({ id: schema.notifications.id });
    if (result.length === 0) return reply.notFound();
    return { ok: true };
  });

  app.post("/notifications/mark-all-read", auth, async (req) => {
    const db = getDb();
    const result = await db
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.userId, req.user.sub),
          eq(schema.notifications.read, false)
        )
      )
      .returning({ id: schema.notifications.id });
    return { marked: result.length };
  });
}
