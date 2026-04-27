import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import type { BrokerNotifyJob } from "@pointer/queue";
import { newId } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";

/**
 * Persists every broker-notify event into `notifications` for the assigned
 * broker's user. The same event is already pushed via SSE in the producer
 * (transfer_to_broker, followup-processor, watchdog, sla-alerts) — this gives
 * the receiving user a survivable inbox so the bell badge stays correct after
 * a reload or while the user is offline.
 *
 * brokerId === "unassigned" → drop (no user to notify).
 */
export async function processBrokerNotify(
  job: BrokerNotifyJob,
  db: Database,
  logger: Logger
) {
  if (job.brokerId === "unassigned" || !job.brokerId) {
    logger.debug({ job }, "broker-notify: unassigned, skip");
    return;
  }

  const broker = await db.query.brokers.findFirst({
    where: eq(schema.brokers.id, job.brokerId),
    columns: { userId: true }
  });
  if (!broker) {
    logger.warn({ brokerId: job.brokerId }, "broker-notify: broker not found");
    return;
  }

  const { title, body } = renderTitle(job);
  await db.insert(schema.notifications).values({
    id: newId(),
    userId: broker.userId,
    kind: job.kind,
    title,
    body,
    refId: job.conversationId || null,
    refType: job.conversationId ? "conversation" : null,
    read: false
  });

  logger.info(
    { brokerId: job.brokerId, kind: job.kind },
    "broker-notify: persisted"
  );
}

function renderTitle(job: BrokerNotifyJob): { title: string; body: string | null } {
  const msg = job.message ?? "";
  switch (job.kind) {
    case "handoff":
      return { title: "Lead transferido para você", body: msg };
    case "new_message":
      return { title: "Nova mensagem", body: msg };
    case "followup":
      return { title: "Follow-up pendente", body: msg };
    case "redistribute":
      return { title: "Lead reatribuído", body: msg };
    case "sla":
      return { title: "Alerta de SLA", body: msg };
    default:
      return { title: "Notificação", body: msg };
  }
}
