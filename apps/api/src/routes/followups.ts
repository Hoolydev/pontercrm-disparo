import { schema } from "@pointer/db";
import type { FollowupStatus, FollowupStep } from "@pointer/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";

const STEP_ORDER: FollowupStep[] = [
  "broker_30min",
  "broker_24h",
  "broker_48h",
  "broker_5d",
  "redistribute_15d"
];

export async function registerFollowups(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };
  const supervisorGuard = {
    preHandler: [app.authenticate, app.requireRole("admin", "supervisor")]
  };

  app.get<{
    Querystring: {
      status?: string;
      brokerId?: string;
      leadId?: string;
      step?: string;
      page?: string;
    };
  }>("/followups", auth, async (req) => {
    const db = getDb();
    const limit = 100;
    const offset = (parseInt(req.query.page ?? "1", 10) - 1) * limit;

    const where = [];
    if (req.query.status) where.push(eq(schema.leadFollowups.status, req.query.status as FollowupStatus));
    if (req.query.brokerId) where.push(eq(schema.leadFollowups.brokerId, req.query.brokerId));
    if (req.query.leadId) where.push(eq(schema.leadFollowups.leadId, req.query.leadId));
    if (req.query.step && STEP_ORDER.includes(req.query.step as FollowupStep)) {
      where.push(eq(schema.leadFollowups.step, req.query.step as FollowupStep));
    }

    const rows = await db.query.leadFollowups.findMany({
      where: where.length ? and(...where) : undefined,
      orderBy: [desc(schema.leadFollowups.scheduledFor)],
      limit,
      offset,
      with: {
        lead: { columns: { id: true, name: true, phone: true } },
        broker: { columns: { id: true, displayName: true } },
        conversation: { columns: { id: true, status: true } },
        campaign: { columns: { id: true, name: true } }
      }
    });

    return { followups: rows, page: parseInt(req.query.page ?? "1", 10), limit };
  });

  app.post<{ Params: { id: string } }>(
    "/followups/:id/cancel",
    supervisorGuard,
    async (req, reply) => {
      const body = z.object({ reason: z.string().optional() }).safeParse(req.body);
      const reason = body.success ? body.data.reason ?? "manual" : "manual";

      const db = getDb();
      const row = await db.query.leadFollowups.findFirst({
        where: eq(schema.leadFollowups.id, req.params.id),
        columns: { id: true, status: true }
      });
      if (!row) return reply.notFound();
      if (row.status !== "pending") {
        return reply.badRequest(`followup is already ${row.status}`);
      }

      await db
        .update(schema.leadFollowups)
        .set({ status: "cancelled", resultJson: { reason, cancelledBy: req.user.sub } })
        .where(eq(schema.leadFollowups.id, req.params.id));

      return { ok: true };
    }
  );

  // Quick aggregation for the page header.
  app.get("/followups/stats", auth, async () => {
    const db = getDb();
    const rows = await db
      .select({
        status: schema.leadFollowups.status,
        step: schema.leadFollowups.step
      })
      .from(schema.leadFollowups);

    const byStatus: Record<string, number> = {};
    const byStep: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byStep[r.step] = (byStep[r.step] ?? 0) + 1;
    }
    return { byStatus, byStep };
  });
}
