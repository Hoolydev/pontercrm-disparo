import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { newId } from "@pointer/shared";
import { and, eq, sql } from "drizzle-orm";
import { recordEvent } from "./domain-events.js";

export type PriorityHint = "low" | "normal" | "high";

const TIMEOUT_MS_BY_PRIORITY: Record<PriorityHint, number> = {
  high: 5 * 60 * 1000,
  normal: 15 * 60 * 1000,
  low: 30 * 60 * 1000
};

export function timeoutMsForPriority(p: string | null | undefined): number {
  if (p === "high" || p === "low") return TIMEOUT_MS_BY_PRIORITY[p];
  return TIMEOUT_MS_BY_PRIORITY.normal;
}

/**
 * Pick the next available broker. Algorithm:
 *
 *   1. Active brokers only.
 *   2. Excludes any in `excludeIds` (used during redistribution so the broker
 *      that just timed out doesn't immediately get the same lead back).
 *   3. Capacity check: counts a broker's "active leads" as the conversations
 *      currently assigned to them whose lead's pipeline_stage.category='open'
 *      (won/lost don't count). Brokers AT or ABOVE `max_active_leads` are
 *      excluded — unless that empties the pool, in which case we fall back
 *      to ignoring capacity (graceful degradation).
 *   4. priority_hint='high' tightens the cut to 80% capacity for headroom;
 *      'normal' uses 100%; 'low' ignores capacity entirely.
 *   5. Sort: load ASC, last_assigned_at ASC (oldest first), tie-break
 *      round_robin_weight DESC.
 */
export async function pickBrokerForLead(
  db: Database,
  opts: {
    excludeIds?: string[];
    priorityHint?: PriorityHint | string | null;
  } = {}
): Promise<string | null> {
  const exclude = opts.excludeIds ?? [];
  const priority: PriorityHint =
    opts.priorityHint === "low" || opts.priorityHint === "high"
      ? opts.priorityHint
      : "normal";

  const headroomFactor = priority === "high" ? 0.8 : 1.0;
  const includeOverCapacity = priority === "low";

  const excludeClause =
    exclude.length > 0
      ? sql`AND b.id NOT IN (${sql.join(
          exclude.map((id) => sql`${id}`),
          sql`, `
        )})`
      : sql``;

  const capacityClause = includeOverCapacity
    ? sql``
    : sql`AND (
        b.max_active_leads IS NULL
        OR (
          SELECT count(*)::int
          FROM ${schema.conversations} c
          JOIN ${schema.leads} l ON l.id = c.lead_id
          JOIN ${schema.pipelineStages} ps ON ps.id = l.pipeline_stage_id
          WHERE c.assigned_broker_id = b.id
            AND c.status IN ('ai_active', 'handed_off')
            AND ps.category = 'open'
        ) < (b.max_active_leads * ${headroomFactor}::float)
      )`;

  const candidates = await db.execute<{ id: string }>(sql`
    SELECT b.id
    FROM ${schema.brokers} b
    WHERE b.active = true
    ${excludeClause}
    ${capacityClause}
    ORDER BY (
      SELECT count(*)::int FROM ${schema.brokerQueue} bq
       WHERE bq.broker_id = b.id AND bq.status = 'pending'
    ) ASC,
    (
      SELECT max(assigned_at) FROM ${schema.brokerQueue} bq2
       WHERE bq2.broker_id = b.id
    ) ASC NULLS FIRST,
    b.round_robin_weight DESC
    LIMIT 1
  `);

  const list = Array.isArray(candidates)
    ? (candidates as Array<{ id: string }>)
    : (candidates as { rows: Array<{ id: string }> }).rows;

  if (list[0]) return list[0].id;

  // Graceful fallback: if capacity filter emptied the pool, retry without it.
  if (!includeOverCapacity) {
    const fallback = await db.execute<{ id: string }>(sql`
      SELECT b.id FROM ${schema.brokers} b
      WHERE b.active = true
      ${excludeClause}
      ORDER BY (
        SELECT count(*)::int FROM ${schema.brokerQueue} bq
         WHERE bq.broker_id = b.id AND bq.status = 'pending'
      ) ASC, b.round_robin_weight DESC
      LIMIT 1
    `);
    const flist = Array.isArray(fallback)
      ? (fallback as Array<{ id: string }>)
      : (fallback as { rows: Array<{ id: string }> }).rows;
    return flist[0]?.id ?? null;
  }

  return null;
}

/**
 * Insert a new broker_queue row. Idempotent for an active assignment.
 * Timeout adapts to priorityHint: 5min high / 15min normal / 30min low.
 */
export async function recordBrokerAssignment(
  db: Database,
  opts: {
    leadId: string;
    brokerId: string;
    conversationId?: string | null;
    priorityHint?: string | null;
    timeoutMs?: number;
    reason?: string;
    attempts?: number;
  }
): Promise<{ id: string; reused: boolean }> {
  const existing = await db.query.brokerQueue.findFirst({
    where: and(
      eq(schema.brokerQueue.leadId, opts.leadId),
      eq(schema.brokerQueue.brokerId, opts.brokerId),
      eq(schema.brokerQueue.status, "pending")
    ),
    columns: { id: true }
  });
  if (existing) return { id: existing.id, reused: true };

  const id = newId();
  const ms = opts.timeoutMs ?? timeoutMsForPriority(opts.priorityHint);
  const now = new Date();
  const timeoutAt = new Date(now.getTime() + ms);
  await db.insert(schema.brokerQueue).values({
    id,
    leadId: opts.leadId,
    brokerId: opts.brokerId,
    conversationId: opts.conversationId ?? undefined,
    priorityHint: opts.priorityHint ?? undefined,
    assignedAt: now,
    timeoutAt,
    attempts: opts.attempts ?? 1,
    reason: opts.reason ?? undefined,
    status: "pending"
  });

  await recordEvent(db, "broker_queue", id, "broker.assigned", {
    payload: {
      leadId: opts.leadId,
      brokerId: opts.brokerId,
      conversationId: opts.conversationId ?? null,
      priorityHint: opts.priorityHint ?? null,
      timeoutAt: timeoutAt.toISOString(),
      reason: opts.reason ?? null
    }
  });

  return { id, reused: false };
}

/** Mark broker as having accepted (responded). Idempotent. */
export async function markBrokerAccepted(db: Database, conversationId: string) {
  await db
    .update(schema.brokerQueue)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(
      and(
        eq(schema.brokerQueue.conversationId, conversationId),
        eq(schema.brokerQueue.status, "pending")
      )
    );
}
