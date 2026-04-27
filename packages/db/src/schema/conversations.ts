import type { ConversationMode, ConversationStatus } from "@pointer/shared";
import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { brokers } from "./brokers.js";
import { campaigns } from "./campaigns.js";
import { createdAt, id, updatedAt } from "./_common.js";
import { leads } from "./leads.js";
import { whatsappInstances } from "./whatsapp-instances.js";

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    status: text("status").$type<ConversationStatus>().notNull().default("ai_active"),
    mode: text("mode").$type<ConversationMode>(),
    assignedBrokerId: uuid("assigned_broker_id").references(() => brokers.id, {
      onDelete: "set null"
    }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    whatsappInstanceId: uuid("whatsapp_instance_id").references(() => whatsappInstances.id, {
      onDelete: "set null"
    }),
    aiPaused: boolean("ai_paused").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lockVersion: integer("lock_version").notNull().default(0),
    handoffReason: text("handoff_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    leadIdx: index("conversations_lead_idx").on(t.leadId),
    campaignStatusIdx: index("conversations_campaign_status_idx").on(t.campaignId, t.status),
    brokerStatusIdx: index("conversations_broker_status_idx").on(t.assignedBrokerId, t.status),
    instanceIdx: index("conversations_instance_idx").on(t.whatsappInstanceId),
    lastMessageIdx: index("conversations_last_message_idx").on(t.lastMessageAt)
  })
);

export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationInsert = typeof conversations.$inferInsert;
