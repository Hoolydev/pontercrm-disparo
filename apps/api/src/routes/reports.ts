import { schema } from "@pointer/db";
import { count, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

/**
 * Read-only aggregations for the /app/reports page.
 * - Range: last 30d for KPIs / last 12 weeks for the bar chart.
 * - Caller restricts to admin/supervisor.
 *
 * All aggregations are computed on demand. The data volume in this product
 * stays modest (single-tenant) — no need for materialized views yet.
 */
export async function registerReports(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireRole("admin", "supervisor")] };

  app.get("/reports/monthly", guard, async () => {
    const db = getDb();
    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const since12w = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);

    // ── KPIs (last 30 days) ───────────────────────────────────────────
    const [
      totalLeads30d,
      wonLeads30d,
      handoffs30d,
      conversionsAll
    ] = await Promise.all([
      db.select({ n: count() }).from(schema.leads).where(gte(schema.leads.createdAt, since30d)),
      db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n
        FROM ${schema.leads} l
        JOIN ${schema.pipelineStages} ps ON ps.id = l.pipeline_stage_id
        WHERE ps.category = 'won'
          AND l.updated_at >= ${since30d.toISOString()}
      `),
      db
        .select({ n: count() })
        .from(schema.conversations)
        .where(eq(schema.conversations.status, "handed_off")),
      db.execute<{ category: string; n: number }>(sql`
        SELECT ps.category, count(*)::int AS n
        FROM ${schema.leads} l
        JOIN ${schema.pipelineStages} ps ON ps.id = l.pipeline_stage_id
        GROUP BY ps.category
      `)
    ]);

    const totalLeads = Number(totalLeads30d[0]?.n ?? 0);
    const wonLeads = Number(toRows(wonLeads30d)[0]?.n ?? 0);
    const conversionRate = totalLeads > 0 ? wonLeads / totalLeads : 0;

    // CPL = total cost of active sources / total leads. Reasonable proxy.
    const sourcesAgg = await db.execute<{ leads_count: number; cost_total: number | null }>(sql`
      SELECT
        (SELECT count(*)::int FROM ${schema.leads}) AS leads_count,
        0::int AS cost_total -- lead_sources.cost not in our schema yet; placeholder
    `);
    // Placeholder: schema doesn't track cost yet; CPL stays 0. Hook up when
    // lead_sources gains a cost column.
    const cpl = 0;

    // ── Weekly buckets (last 12 weeks) ────────────────────────────────
    const weeklyRows = await db.execute<{ week: string; leads: number; won: number }>(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', ${since12w.toISOString()}::timestamptz),
          date_trunc('week', now()),
          '7 days'::interval
        ) AS week
      )
      SELECT
        to_char(w.week, 'YYYY-MM-DD') AS week,
        coalesce((SELECT count(*)::int FROM ${schema.leads} l WHERE date_trunc('week', l.created_at) = w.week), 0) AS leads,
        coalesce((
          SELECT count(*)::int
          FROM ${schema.leads} l
          JOIN ${schema.pipelineStages} ps ON ps.id = l.pipeline_stage_id
          WHERE ps.category = 'won' AND date_trunc('week', l.updated_at) = w.week
        ), 0) AS won
      FROM weeks w
      ORDER BY w.week
    `);

    // ── By source ─────────────────────────────────────────────────────
    const bySourceRows = await db.execute<{
      source_id: string;
      source_name: string;
      leads_count: number;
      won_count: number;
    }>(sql`
      SELECT
        s.id AS source_id,
        s.name AS source_name,
        count(l.id)::int AS leads_count,
        count(CASE WHEN ps.category = 'won' THEN 1 END)::int AS won_count
      FROM ${schema.leadSources} s
      LEFT JOIN ${schema.leads} l ON l.source_id = s.id
      LEFT JOIN ${schema.pipelineStages} ps ON ps.id = l.pipeline_stage_id
      GROUP BY s.id, s.name
      ORDER BY leads_count DESC
    `);

    // ── Funnel (default pipeline stages × current lead counts) ────────
    const funnelRows = await db.execute<{
      stage_id: string;
      stage_name: string;
      position: number;
      category: string;
      leads_count: number;
    }>(sql`
      SELECT
        ps.id AS stage_id,
        ps.name AS stage_name,
        ps.position,
        ps.category,
        count(l.id)::int AS leads_count
      FROM ${schema.pipelineStages} ps
      JOIN ${schema.pipelines} p ON p.id = ps.pipeline_id AND p.is_default = true
      LEFT JOIN ${schema.leads} l ON l.pipeline_stage_id = ps.id
      GROUP BY ps.id, ps.name, ps.position, ps.category
      ORDER BY ps.position
    `);

    // ── Agent performance ─────────────────────────────────────────────
    const agentRows = await db.execute<{
      agent_id: string;
      agent_name: string;
      type: string;
      conv_count: number;
      msg_count: number;
    }>(sql`
      SELECT
        a.id AS agent_id,
        a.name AS agent_name,
        a.type,
        count(DISTINCT c.id)::int AS conv_count,
        coalesce((
          SELECT count(*)::int
          FROM ${schema.messages} m
          WHERE m.conversation_id IN (
            SELECT id FROM ${schema.conversations} WHERE agent_id = a.id
          )
            AND m.sender_type = 'ai'
        ), 0) AS msg_count
      FROM ${schema.agents} a
      LEFT JOIN ${schema.conversations} c ON c.agent_id = a.id
      WHERE a.active = true
      GROUP BY a.id, a.name, a.type
      ORDER BY conv_count DESC
    `);

    return {
      kpis: {
        totalLeads,
        wonLeads,
        conversionRate,
        cpl,
        handoffsActive: Number(handoffs30d[0]?.n ?? 0)
      },
      categoryDistribution: toRows(conversionsAll).map((r) => ({
        category: r.category,
        n: Number(r.n)
      })),
      weekly: toRows(weeklyRows).map((r) => ({
        week: r.week,
        leads: Number(r.leads),
        won: Number(r.won)
      })),
      bySource: toRows(bySourceRows).map((r) => ({
        sourceId: r.source_id,
        sourceName: r.source_name,
        leads: Number(r.leads_count),
        won: Number(r.won_count),
        conversionRate:
          Number(r.leads_count) > 0 ? Number(r.won_count) / Number(r.leads_count) : 0
      })),
      funnel: toRows(funnelRows).map((r) => ({
        stageId: r.stage_id,
        stageName: r.stage_name,
        position: Number(r.position),
        category: r.category,
        leads: Number(r.leads_count)
      })),
      agents: toRows(agentRows).map((r) => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        type: r.type,
        conversations: Number(r.conv_count),
        messagesSent: Number(r.msg_count)
      }))
    };
  });
}

function toRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}
