import type { FollowupStatus, FollowupStep } from "@pointer/shared";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { brokers } from "./brokers.js";
import { campaigns } from "./campaigns.js";
import { conversations } from "./conversations.js";
import { createdAt, id, updatedAt } from "./_common.js";
import { leads } from "./leads.js";

/**
 * Follow-up sequence for "cobrança ao corretor" — pure deterministic queue,
 * not driven by the AI. Created when a lead is handed off; cancelled when the
 * broker responds; redistributed at the +15d step.
 */
export const leadFollowups = pgTable(
  "lead_followups",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null"
    }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    brokerId: uuid("broker_id").references(() => brokers.id, { onDelete: "set null" }),
    step: text("step").$type<FollowupStep>().notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: text("status").$type<FollowupStatus>().notNull().default("pending"),
    triggerEvent: text("trigger_event"),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    dueIdx: index("lead_followups_due_idx").on(t.status, t.scheduledFor),
    leadIdx: index("lead_followups_lead_idx").on(t.leadId),
    conversationIdx: index("lead_followups_conversation_idx").on(t.conversationId)
  })
);

export type LeadFollowupRow = typeof leadFollowups.$inferSelect;
export type LeadFollowupInsert = typeof leadFollowups.$inferInsert;
