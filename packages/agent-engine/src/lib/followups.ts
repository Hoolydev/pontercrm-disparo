import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { FOLLOWUP_STEP, FOLLOWUP_STEP_OFFSET_MS, newId } from "@pointer/shared";
import type { FollowupStep } from "@pointer/shared";
import { and, eq, inArray, ne } from "drizzle-orm";

/**
 * A lead is in a "final" state when its current pipeline_stage.category is
 * 'won' or 'lost'. In that case we don't create new cobrança chains and any
 * pending ones get cancelled.
 */
export async function isLeadInFinalStage(db: Database, leadId: string): Promise<boolean> {
  const lead = await db.query.leads.findFirst({
    where: eq(schema.leads.id, leadId),
    columns: { pipelineStageId: true }
  });
  if (!lead?.pipelineStageId) return false;
  const stage = await db.query.pipelineStages.findFirst({
    where: eq(schema.pipelineStages.id, lead.pipelineStageId),
    columns: { category: true }
  });
  return stage?.category === "won" || stage?.category === "lost";
}

/**
 * Create the canonical 5-step follow-up sequence for a broker handoff.
 * Idempotent: if a pending row already exists for this conversation, returns 0.
 * Skips creation entirely if the lead is already in a final stage.
 */
export async function createBrokerFollowups(
  db: Database,
  opts: {
    leadId: string;
    conversationId: string;
    campaignId?: string | null;
    brokerId: string | null;
    triggerEvent: string;
  }
): Promise<{ created: number; reason?: string }> {
  if (await isLeadInFinalStage(db, opts.leadId)) {
    return { created: 0, reason: "lead_in_final_stage" };
  }

  const existing = await db.query.leadFollowups.findFirst({
    where: and(
      eq(schema.leadFollowups.conversationId, opts.conversationId),
      eq(schema.leadFollowups.status, "pending")
    ),
    columns: { id: true }
  });
  if (existing) return { created: 0, reason: "already_pending" };

  const now = Date.now();
  const rows = FOLLOWUP_STEP.map((step) => ({
    id: newId(),
    leadId: opts.leadId,
    conversationId: opts.conversationId,
    campaignId: opts.campaignId ?? undefined,
    brokerId: opts.brokerId ?? undefined,
    step: step as FollowupStep,
    scheduledFor: new Date(now + FOLLOWUP_STEP_OFFSET_MS[step]),
    status: "pending" as const,
    triggerEvent: opts.triggerEvent
  }));

  await db.insert(schema.leadFollowups).values(rows);
  return { created: rows.length };
}

/**
 * Cancel all pending follow-ups for a conversation. Called when the broker
 * accepts (sends a message) — the cobrança chain is short-circuited.
 */
export async function cancelPendingFollowups(
  db: Database,
  conversationId: string,
  reason: string
): Promise<{ cancelled: number }> {
  const result = await db
    .update(schema.leadFollowups)
    .set({
      status: "cancelled",
      resultJson: { reason }
    })
    .where(
      and(
        eq(schema.leadFollowups.conversationId, conversationId),
        eq(schema.leadFollowups.status, "pending")
      )
    )
    .returning({ id: schema.leadFollowups.id });
  return { cancelled: result.length };
}

/**
 * Cancel pending followups by lead — used when the lead's stage moves to a
 * final category (won/lost). Idempotent.
 */
export async function cancelPendingFollowupsForLead(
  db: Database,
  leadId: string,
  reason: string
): Promise<{ cancelled: number }> {
  const result = await db
    .update(schema.leadFollowups)
    .set({ status: "cancelled", resultJson: { reason } })
    .where(
      and(
        eq(schema.leadFollowups.leadId, leadId),
        eq(schema.leadFollowups.status, "pending")
      )
    )
    .returning({ id: schema.leadFollowups.id });
  return { cancelled: result.length };
}

/**
 * Cancel pending followups for a SET of conversations. Used by watchdog after
 * a redistribution: the old broker's pending cobranças are dropped.
 */
export async function cancelPendingFollowupsForBroker(
  db: Database,
  brokerId: string,
  leadId: string,
  reason: string
) {
  return db
    .update(schema.leadFollowups)
    .set({ status: "cancelled", resultJson: { reason } })
    .where(
      and(
        eq(schema.leadFollowups.brokerId, brokerId),
        eq(schema.leadFollowups.leadId, leadId),
        eq(schema.leadFollowups.status, "pending")
      )
    );
}

/** Mark followups in `ids` as `sent` in one shot. */
export async function markFollowupsSent(
  db: Database,
  ids: string[],
  result: Record<string, unknown>
) {
  if (!ids.length) return;
  await db
    .update(schema.leadFollowups)
    .set({ status: "sent", resultJson: result })
    .where(and(inArray(schema.leadFollowups.id, ids), ne(schema.leadFollowups.status, "cancelled")));
}
