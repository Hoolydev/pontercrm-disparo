import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { brokers } from "./brokers.js";
import { createdAt, id, updatedAt } from "./_common.js";
import { leadSources } from "./lead-sources.js";
import { pipelineStages } from "./pipeline-stages.js";

export const leads = pgTable(
  "leads",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => leadSources.id),
    externalId: text("external_id"),
    name: text("name"),
    email: text("email"),
    phone: text("phone").notNull(), // E.164
    propertyRef: text("property_ref"),
    origin: text("origin"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    pipelineStageId: uuid("pipeline_stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    assignedBrokerId: uuid("assigned_broker_id").references(() => brokers.id, {
      onDelete: "set null"
    }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    /** Timestamp of the last `pipeline_stage_id` change. Used for SLA tracking. */
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    sourceExternalUq: uniqueIndex("leads_source_external_uq").on(t.sourceId, t.externalId),
    phoneIdx: index("leads_phone_idx").on(t.phone),
    stageIdx: index("leads_stage_idx").on(t.pipelineStageId),
    brokerIdx: index("leads_broker_idx").on(t.assignedBrokerId)
  })
);

export type LeadRow = typeof leads.$inferSelect;
export type LeadInsert = typeof leads.$inferInsert;
