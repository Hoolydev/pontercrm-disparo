import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { createdAt, updatedAt } from "./_common.js";

export const conversationMemory = pgTable("conversation_memory", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  lastSummarizedAt: timestamp("last_summarized_at", { withTimezone: true }),
  tokensUsed: integer("tokens_used").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export type ConversationMemoryRow = typeof conversationMemory.$inferSelect;
export type ConversationMemoryInsert = typeof conversationMemory.$inferInsert;
