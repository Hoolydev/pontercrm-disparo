import { boolean, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_common.js";
import { users } from "./users.js";

/**
 * In-app notifications for users (brokers, supervisors, admins). Persisted so
 * "unread badge" survives reload. Worker side: writes from the broker-notify
 * queue handler. Read side: GET /notifications + mark-as-read.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 'handoff' | 'followup' | 'redistribute' | 'sla' | 'system' */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Optional UUID linking to the source row (conversation, lead, …). */
    refId: uuid("ref_id"),
    refType: text("ref_type"), // 'conversation' | 'lead' | 'campaign' | etc
    read: boolean("read").notNull().default(false),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
    createdAt: createdAt()
  },
  (t) => ({
    userUnreadIdx: index("notifications_user_unread_idx").on(t.userId, t.read, t.createdAt)
  })
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;
