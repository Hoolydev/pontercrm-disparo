import type { ToolExecutionStatus } from "@pointer/shared";
import { jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { createdAt, id } from "./_common.js";
import { messages } from "./messages.js";

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    argumentsJson: jsonb("arguments_json").$type<Record<string, unknown>>().notNull().default({}),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    status: text("status").$type<ToolExecutionStatus>().notNull(),
    error: text("error"),
    createdAt: createdAt()
  },
  (t) => ({
    messageToolUq: uniqueIndex("tool_executions_message_tool_uq").on(t.messageId, t.toolName)
  })
);

export type ToolExecutionRow = typeof toolExecutions.$inferSelect;
export type ToolExecutionInsert = typeof toolExecutions.$inferInsert;
