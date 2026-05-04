import type { DomainAggregateType, DomainEventType } from "@pointer/shared";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_common.js";

export const domainEvents = pgTable(
  "domain_events",
  {
    id: id(),
    aggregateType: text("aggregate_type").$type<DomainAggregateType>().notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").$type<DomainEventType>().notNull(),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    actor: text("actor"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    aggregateIdx: index("domain_events_aggregate_idx").on(
      t.aggregateType,
      t.aggregateId,
      t.occurredAt
    ),
    eventTypeIdx: index("domain_events_event_type_idx").on(t.eventType, t.occurredAt)
  })
);

export type DomainEventRow = typeof domainEvents.$inferSelect;
export type DomainEventInsert = typeof domainEvents.$inferInsert;
