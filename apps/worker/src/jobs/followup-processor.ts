import {
  cancelPendingFollowupsForBroker,
  cancelPendingFollowupsForLead,
  createBrokerFollowups,
  isLeadInFinalStage,
  pickBrokerForLead,
  recordBrokerAssignment
} from "@pointer/agent-engine";
import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

const CH_INBOX = "inbox:updates";
const BATCH = 100;

/**
 * Periodic sweep — runs every 60s. Finds lead_followups rows whose status is
 * 'pending' and scheduled_for has passed, then dispatches the appropriate
 * action per step.
 *
 * Steps:
 *   - broker_30min / broker_24h / broker_48h / broker_5d:
 *       send a broker-notify "cobrança" reminder, mark as 'sent'.
 *   - redistribute_15d:
 *       pick a different broker (excluding current), create new broker_queue
 *       row + new follow-up chain, transfer the conversation, cancel any
 *       remaining pending followups for the OLD broker.
 */
export async function processFollowupSweep(
  _job: unknown,
  db: Database,
  publisher: Redis,
  logger: Logger
) {
  const due = await db.query.leadFollowups.findMany({
    where: and(
      eq(schema.leadFollowups.status, "pending"),
      lte(schema.leadFollowups.scheduledFor, new Date())
    ),
    orderBy: [asc(schema.leadFollowups.scheduledFor)],
    limit: BATCH
  });

  if (due.length === 0) return;
  logger.info({ count: due.length }, "followup-processor: due rows");

  const queues = getQueues();

  for (const f of due) {
    try {
      // Lead reached a final stage (won/lost) → drop the whole chain.
      if (await isLeadInFinalStage(db, f.leadId)) {
        await mark(db, f.id, "skipped", { reason: "lead_in_final_stage" });
        await cancelPendingFollowupsForLead(db, f.leadId, "lead_in_final_stage");
        continue;
      }

      // Skip if the broker has already accepted (broker_queue.responded_at set)
      if (f.conversationId) {
        const conv = await db.query.conversations.findFirst({
          where: eq(schema.conversations.id, f.conversationId),
          columns: { id: true, aiPaused: true, status: true, leadId: true }
        });
        if (!conv) {
          await mark(db, f.id, "skipped", { reason: "no_conversation" });
          continue;
        }
        // If conversation re-activated AI (lead returned, broker released) — drop the chain
        if (!conv.aiPaused && conv.status === "ai_active") {
          await mark(db, f.id, "skipped", { reason: "ai_resumed" });
          continue;
        }
      }

      if (f.step === "redistribute_15d") {
        await runRedistribution(db, publisher, logger, f);
      } else {
        await runReminder(db, queues, f);
      }
    } catch (err) {
      logger.error({ err, followupId: f.id }, "followup-processor: step failed");
    }
  }
}

async function mark(
  db: Database,
  id: string,
  status: "sent" | "skipped" | "done",
  result: Record<string, unknown>
) {
  await db
    .update(schema.leadFollowups)
    .set({ status, resultJson: result })
    .where(eq(schema.leadFollowups.id, id));
}

async function runReminder(
  db: Database,
  queues: ReturnType<typeof getQueues>,
  f: typeof schema.leadFollowups.$inferSelect
) {
  if (f.brokerId) {
    await queues.brokerNotify.add(`followup-${f.id}`, {
      brokerId: f.brokerId,
      conversationId: f.conversationId ?? "",
      kind: "followup",
      message: `Follow-up: ${f.step} (lead aguardando)`
    });
  }
  await mark(db, f.id, "sent", { step: f.step, sentAt: new Date().toISOString() });
}

async function runRedistribution(
  db: Database,
  publisher: Redis,
  logger: Logger,
  f: typeof schema.leadFollowups.$inferSelect
) {
  if (!f.conversationId) {
    await mark(db, f.id, "skipped", { reason: "no_conversation" });
    return;
  }

  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, f.conversationId)
  });
  if (!conv) {
    await mark(db, f.id, "skipped", { reason: "no_conversation" });
    return;
  }

  const exclude = f.brokerId ? [f.brokerId] : [];
  const next = await pickBrokerForLead(db, { excludeIds: exclude });
  if (!next) {
    logger.warn({ followupId: f.id, leadId: f.leadId }, "redistribute: no other broker available");
    await mark(db, f.id, "skipped", { reason: "no_alternative_broker" });
    return;
  }

  // Mark previous broker_queue as 'reassigned'
  if (f.brokerId) {
    await db
      .update(schema.brokerQueue)
      .set({ status: "reassigned" })
      .where(
        and(
          eq(schema.brokerQueue.conversationId, f.conversationId),
          eq(schema.brokerQueue.brokerId, f.brokerId),
          eq(schema.brokerQueue.status, "pending")
        )
      );
    await cancelPendingFollowupsForBroker(db, f.brokerId, f.leadId, "redistributed_15d");
  }

  await db
    .update(schema.conversations)
    .set({ assignedBrokerId: next })
    .where(eq(schema.conversations.id, f.conversationId));
  await db
    .update(schema.leads)
    .set({ assignedBrokerId: next })
    .where(eq(schema.leads.id, f.leadId));

  await recordBrokerAssignment(db, {
    leadId: f.leadId,
    brokerId: next,
    conversationId: f.conversationId,
    reason: "redistribution_15d",
    attempts: 2
  });
  await createBrokerFollowups(db, {
    leadId: f.leadId,
    conversationId: f.conversationId,
    campaignId: f.campaignId,
    brokerId: next,
    triggerEvent: "redistribute_15d"
  });

  await mark(db, f.id, "done", { redistributedTo: next, previous: f.brokerId });

  await publisher.publish(
    CH_INBOX,
    JSON.stringify({
      kind: "lead:redistributed",
      conversationId: f.conversationId,
      leadId: f.leadId,
      previousBrokerId: f.brokerId,
      brokerId: next
    })
  );

  logger.info(
    { conversationId: f.conversationId, leadId: f.leadId, previous: f.brokerId, next },
    "followup-processor: redistribution done"
  );
}
