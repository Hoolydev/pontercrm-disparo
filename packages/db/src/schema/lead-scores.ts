import type { LeadClassification } from "@pointer/shared";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { leads } from "./leads.js";

export const leadScores = pgTable("lead_scores", {
  leadId: uuid("lead_id")
    .primaryKey()
    .references(() => leads.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
  classification: text("classification").$type<LeadClassification>().notNull().default("cold"),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export type LeadScoreRow = typeof leadScores.$inferSelect;
export type LeadScoreInsert = typeof leadScores.$inferInsert;
