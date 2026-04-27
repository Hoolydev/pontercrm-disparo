import {
  createBrokerFollowups,
  cancelPendingFollowupsForBroker,
  pickBrokerForLead,
  recordBrokerAssignment
} from "@pointer/agent-engine";
import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { and, asc, eq, lte } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

const CH_INBOX = "inbox:updates";
const BATCH = 50;

/**
 * Watches broker_queue for rows that have timed out without acceptance.
 * Marks them 'timeout' and reassigns to another broker (excluding the one
 * that just timed out). Increments attempt counter.
 */
export async function processDistributionWatchdog(
  _job: unknown,
  db: Database,
  publisher: Redis,
  logger: Logger
) {
  const expired = await db.query.brokerQueue.findMany({
    where: and(
      eq(schema.brokerQueue.status, "pending"),
      lte(schema.brokerQueue.timeoutAt, new Date())
    ),
    orderBy: [asc(schema.brokerQueue.timeoutAt)],
    limit: BATCH
  });

  if (expired.length === 0) return;
  logger.info({ count: expired.length }, "distribution-watchdog: timed-out rows");

  const queues = getQueues();

  for (const row of expired) {
    try {
      // Mark this attempt as timeout
      await db
        .update(schema.brokerQueue)
        .set({ status: "timeout" })
        .where(eq(schema.brokerQueue.id, row.id));

      // Cancel cobrança chain for the broker that just timed out
      await cancelPendingFollowupsForBroker(db, row.brokerId, row.leadId, "broker_timeout");

      // Pick next broker, excluding the one that timed out
      const next = await pickBrokerForLead(db, { excludeIds: [row.brokerId] });
      if (!next) {
        logger.warn(
          { leadId: row.leadId, brokerId: row.brokerId },
          "watchdog: no alternative broker — leaving lead unassigned"
        );
        // Notify supervisor (via broker-notify with kind=system)
        await queues.brokerNotify.add(`watchdog:no-broker:${row.id}`, {
          brokerId: "unassigned",
          conversationId: row.conversationId ?? "",
          kind: "system",
          message: `Lead ${row.leadId} sem corretor disponível após timeout`
        });
        continue;
      }

      await recordBrokerAssignment(db, {
        leadId: row.leadId,
        brokerId: next,
        conversationId: row.conversationId,
        priorityHint: row.priorityHint,
        reason: "watchdog_redistribute",
        attempts: row.attempts + 1
      });

      // Update conversation + lead's primary broker
      if (row.conversationId) {
        await db
          .update(schema.conversations)
          .set({ assignedBrokerId: next })
          .where(eq(schema.conversations.id, row.conversationId));
      }
      await db
        .update(schema.leads)
        .set({ assignedBrokerId: next })
        .where(eq(schema.leads.id, row.leadId));

      // New cobrança chain for the new broker
      if (row.conversationId) {
        await createBrokerFollowups(db, {
          leadId: row.leadId,
          conversationId: row.conversationId,
          brokerId: next,
          triggerEvent: "watchdog_redistribute"
        });
      }

      await queues.brokerNotify.add(`watchdog-${row.id}`, {
        brokerId: next,
        conversationId: row.conversationId ?? "",
        kind: "redistribute",
        message: `Lead reatribuído por timeout do corretor anterior`
      });

      await publisher.publish(
        CH_INBOX,
        JSON.stringify({
          kind: "lead:redistributed",
          leadId: row.leadId,
          conversationId: row.conversationId,
          previousBrokerId: row.brokerId,
          brokerId: next,
          reason: "broker_timeout"
        })
      );

      logger.info(
        { leadId: row.leadId, previous: row.brokerId, next, attempts: row.attempts + 1 },
        "watchdog: lead redistributed"
      );
    } catch (err) {
      logger.error({ err, queueRowId: row.id }, "watchdog: redistribution failed");
    }
  }
}
