import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { newId } from "@pointer/shared";
import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

const CH_INBOX = "inbox:updates";
const BATCH = 200;

type Candidate = {
  lead_id: string;
  stage_id: string;
  stage_name: string;
  sla_hours: number;
  hours_in_stage: number;
  broker_id: string | null;
  conversation_id: string | null;
};

/**
 * Periodic SLA sweep — runs every 30 min.
 *
 * Finds leads currently sitting in a stage with `sla_hours` defined and an
 * `open` category, where `now() - leads.stage_entered_at` exceeds
 * `sla_hours`. Idempotent via lead_stage_alerts: a (lead, stage) pair won't
 * fire more than once per 24h.
 *
 * Effects per match:
 *   - INSERT lead_stage_alerts (audit + idempotency anchor)
 *   - Enqueue broker-notify (kind=system) to the assigned broker if any,
 *     else to "unassigned" so a supervisor process can pick it up.
 *   - Publish SSE `lead:sla_alert` for live UIs.
 */
export async function processSlaAlertsSweep(
  _job: unknown,
  db: Database,
  publisher: Redis,
  logger: Logger
) {
  const result = await db.execute<Candidate>(sql`
    SELECT
      l.id AS lead_id,
      ps.id AS stage_id,
      ps.name AS stage_name,
      ps.sla_hours,
      EXTRACT(EPOCH FROM (now() - l.stage_entered_at)) / 3600.0 AS hours_in_stage,
      l.assigned_broker_id AS broker_id,
      (
        SELECT id FROM ${schema.conversations} c
        WHERE c.lead_id = l.id
        ORDER BY c.created_at DESC
        LIMIT 1
      ) AS conversation_id
    FROM ${schema.leads} l
    JOIN ${schema.pipelineStages} ps ON ps.id = l.pipeline_stage_id
    WHERE ps.sla_hours IS NOT NULL
      AND ps.category = 'open'
      AND l.stage_entered_at < (now() - (ps.sla_hours * interval '1 hour'))
      AND NOT EXISTS (
        SELECT 1 FROM ${schema.leadStageAlerts} a
        WHERE a.lead_id = l.id
          AND a.stage_id = ps.id
          AND a.alerted_at > (now() - interval '24 hours')
      )
    ORDER BY l.stage_entered_at ASC
    LIMIT ${BATCH}
  `);

  const list = Array.isArray(result)
    ? (result as Candidate[])
    : (result as { rows: Candidate[] }).rows;

  if (list.length === 0) return;
  logger.info({ count: list.length }, "sla-alerts: candidates found");

  const queues = getQueues();

  for (const c of list) {
    try {
      const hoursOverdue = Math.max(0, Math.floor(Number(c.hours_in_stage) - Number(c.sla_hours)));

      await db.insert(schema.leadStageAlerts).values({
        id: newId(),
        leadId: c.lead_id,
        stageId: c.stage_id,
        hoursOverdue
      });

      await queues.brokerNotify.add(`sla-${c.lead_id}-${c.stage_id}`, {
        brokerId: c.broker_id ?? "unassigned",
        conversationId: c.conversation_id ?? "",
        kind: "sla",
        message: `SLA estourado: lead em "${c.stage_name}" há ${Math.floor(Number(c.hours_in_stage))}h (limite ${c.sla_hours}h)`
      });

      await publisher.publish(
        CH_INBOX,
        JSON.stringify({
          kind: "lead:sla_alert",
          leadId: c.lead_id,
          stageId: c.stage_id,
          stageName: c.stage_name,
          hoursOverdue,
          brokerId: c.broker_id,
          conversationId: c.conversation_id
        })
      );
    } catch (err) {
      logger.error({ err, leadId: c.lead_id, stageId: c.stage_id }, "sla-alerts: alert failed");
    }
  }

  logger.info({ alerted: list.length }, "sla-alerts: done");
}
