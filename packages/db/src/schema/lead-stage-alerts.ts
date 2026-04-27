import { index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_common.js";
import { leads } from "./leads.js";
import { pipelineStages } from "./pipeline-stages.js";

/**
 * Audit log of SLA alerts fired when a lead overstays its current stage's
 * `sla_hours`. The sweep worker uses this table for idempotency: it won't
 * re-alert a (lead_id, stage_id) pair twice within 24h.
 */
export const leadStageAlerts = pgTable(
  "lead_stage_alerts",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "cascade" }),
    /** How many hours over SLA at the moment of alerting. */
    hoursOverdue: integer("hours_overdue").notNull(),
    alertedAt: timestamp("alerted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt()
  },
  (t) => ({
    leadStageIdx: index("lead_stage_alerts_lead_stage_idx").on(t.leadId, t.stageId, t.alertedAt)
  })
);

export type LeadStageAlertRow = typeof leadStageAlerts.$inferSelect;
export type LeadStageAlertInsert = typeof leadStageAlerts.$inferInsert;
