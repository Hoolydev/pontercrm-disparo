import type { AppointmentSource, AppointmentStatus } from "@pointer/shared";
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { brokers } from "./brokers.js";
import { conversations } from "./conversations.js";
import { createdAt, id, updatedAt } from "./_common.js";
import { leads } from "./leads.js";

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    brokerId: uuid("broker_id").references(() => brokers.id, { onDelete: "set null" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    address: text("address"),
    notes: text("notes"),
    status: text("status").$type<AppointmentStatus>().notNull().default("scheduled"),
    source: text("source").$type<AppointmentSource>().notNull().default("ai_tool"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    brokerScheduleIdx: index("appointments_broker_schedule_idx").on(t.brokerId, t.scheduledFor),
    upcomingIdx: index("appointments_upcoming_idx")
      .on(t.scheduledFor)
      .where(sql`${t.status} = 'scheduled'`)
  })
);

export type AppointmentRow = typeof appointments.$inferSelect;
export type AppointmentInsert = typeof appointments.$inferInsert;
