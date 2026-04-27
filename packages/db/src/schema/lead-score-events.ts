import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_common.js";
import { leads } from "./leads.js";

/**
 * Audit log of every signal that contributed to a lead's score.
 * Source can be: 'system' (deterministic regex/event detector), 'ai_signal'
 * (future — AI emitting score_adjustment), or 'manual' (broker override).
 */
export const leadScoreEvents = pgTable(
  "lead_score_events",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    event: text("event").notNull(), // 'replied' | 'asked_visit' | 'mentioned_price' | 'silent_24h' | …
    delta: integer("delta").notNull(),
    source: text("source").notNull(), // 'system' | 'ai_signal' | 'manual'
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
    createdAt: createdAt()
  },
  (t) => ({
    leadCreatedIdx: index("lead_score_events_lead_created_idx").on(t.leadId, t.createdAt)
  })
);

export type LeadScoreEventRow = typeof leadScoreEvents.$inferSelect;
export type LeadScoreEventInsert = typeof leadScoreEvents.$inferInsert;
