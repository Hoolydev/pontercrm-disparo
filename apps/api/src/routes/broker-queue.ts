import { schema } from "@pointer/db";
import type { BrokerQueueStatus } from "@pointer/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

export async function registerBrokerQueue(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get<{
    Querystring: {
      status?: string;
      brokerId?: string;
      leadId?: string;
      page?: string;
    };
  }>("/broker-queue", auth, async (req) => {
    const db = getDb();
    const limit = 100;
    const offset = (parseInt(req.query.page ?? "1", 10) - 1) * limit;

    const where = [];
    if (req.query.status) where.push(eq(schema.brokerQueue.status, req.query.status as BrokerQueueStatus));
    if (req.query.brokerId) where.push(eq(schema.brokerQueue.brokerId, req.query.brokerId));
    if (req.query.leadId) where.push(eq(schema.brokerQueue.leadId, req.query.leadId));

    const rows = await db.query.brokerQueue.findMany({
      where: where.length ? and(...where) : undefined,
      orderBy: [desc(schema.brokerQueue.assignedAt)],
      limit,
      offset,
      with: {
        lead: { columns: { id: true, name: true, phone: true } },
        broker: { columns: { id: true, displayName: true } },
        conversation: { columns: { id: true, status: true } }
      }
    });

    return { entries: rows, page: parseInt(req.query.page ?? "1", 10), limit };
  });

  app.get("/broker-queue/stats", auth, async () => {
    const db = getDb();
    const rows = await db
      .select({ status: schema.brokerQueue.status, brokerId: schema.brokerQueue.brokerId })
      .from(schema.brokerQueue);

    const byStatus: Record<string, number> = {};
    const pendingByBroker: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.status === "pending") {
        pendingByBroker[r.brokerId] = (pendingByBroker[r.brokerId] ?? 0) + 1;
      }
    }
    return { byStatus, pendingByBroker };
  });
}
