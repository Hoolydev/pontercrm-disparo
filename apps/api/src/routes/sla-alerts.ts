import { schema } from "@pointer/db";
import { and, desc, eq, gte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

export async function registerSlaAlerts(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get<{
    Querystring: { sinceHours?: string; stageId?: string; brokerId?: string };
  }>("/sla-alerts", auth, async (req) => {
    const db = getDb();
    const since = parseInt(req.query.sinceHours ?? "168", 10); // default 7d
    const cutoff = new Date(Date.now() - since * 60 * 60 * 1000);

    const where = [gte(schema.leadStageAlerts.alertedAt, cutoff)];
    if (req.query.stageId) where.push(eq(schema.leadStageAlerts.stageId, req.query.stageId));

    const rows = await db.query.leadStageAlerts.findMany({
      where: and(...where),
      orderBy: [desc(schema.leadStageAlerts.alertedAt)],
      limit: 200,
      with: {
        lead: {
          columns: { id: true, name: true, phone: true, assignedBrokerId: true }
        },
        stage: { columns: { id: true, name: true, slaHours: true, category: true } }
      }
    });

    // Optional broker filter on assigned broker (not stored on the alert directly).
    const filtered = req.query.brokerId
      ? rows.filter((a) => a.lead.assignedBrokerId === req.query.brokerId)
      : rows;

    return { alerts: filtered };
  });
}
