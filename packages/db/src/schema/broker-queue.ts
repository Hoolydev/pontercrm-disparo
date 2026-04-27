import type { BrokerQueueStatus } from "@pointer/shared";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { brokers } from "./brokers.js";
import { conversations } from "./conversations.js";
import { createdAt, id } from "./_common.js";
import { leads } from "./leads.js";

/**
 * Broker-side assignment queue with timeout tracking. One row per
 * (lead, broker, attempt). Watchdog reassigns rows that time out.
 *
 * `priority_hint` is intentionally pre-wired (the AI will be able to set
 * "high" later via tool args) but the distribution algorithm itself is
 * deterministic — load + recency.
 */
export const brokerQueue = pgTable(
  "broker_queue",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null"
    }),
    brokerId: uuid("broker_id")
      .notNull()
      .references(() => brokers.id, { onDelete: "cascade" }),
    status: text("status").$type<BrokerQueueStatus>().notNull().default("pending"),
    priorityHint: text("priority_hint"), // 'low' | 'normal' | 'high' (free-form for now)
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(1),
    reason: text("reason"),
    createdAt: createdAt()
  },
  (t) => ({
    pendingTimeoutIdx: index("broker_queue_pending_timeout_idx").on(t.status, t.timeoutAt),
    leadIdx: index("broker_queue_lead_idx").on(t.leadId),
    brokerIdx: index("broker_queue_broker_idx").on(t.brokerId)
  })
);

export type BrokerQueueRow = typeof brokerQueue.$inferSelect;
export type BrokerQueueInsert = typeof brokerQueue.$inferInsert;
