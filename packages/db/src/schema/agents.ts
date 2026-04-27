import type { AgentType } from "@pointer/shared";
import { boolean, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";

export type AgentBehavior = {
  temperature?: number;
  max_tokens?: number;
  max_history_messages?: number;
  delay_range_ms?: [number, number];
  tools_enabled?: string[];
  summarize_after_messages?: number;
  outbound_attachments?: Array<{
    kind: "image" | "video" | "document";
    url: string;
    caption_template?: string;
  }>;
};

export const agents = pgTable(
  "agents",
  {
    id: id(),
    name: text("name").notNull(),
    type: text("type").$type<AgentType>().notNull(),
    model: text("model").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    behaviorJson: jsonb("behavior_json").$type<AgentBehavior>().notNull().default({}),
    /**
     * Outbound-only: opening message template. Supports `{{name}}`, `{{phone}}`,
     * `{{property_ref}}`, `{{origin}}`, `{{campaign}}`. When present, takes
     * precedence over `campaign.firstMessageTemplate` for first-touch.
     */
    firstMessage: text("first_message"),
    /**
     * Outbound-only: the inbound agent that takes over once the lead replies.
     * Engine swaps `conversation.agentId` to this on lead's first reply so all
     * qualification/tool execution happens with the inbound's config.
     */
    handoffAgentId: text("handoff_agent_id"),
    /**
     * Optional ReactFlow blob — visual representation of the outbound's flow
     * (start → first message → attachments → handoff). Pure UI, engine doesn't
     * read this.
     */
    flowJson: jsonb("flow_json").$type<unknown>(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    typeActiveIdx: index("agents_type_active_idx").on(t.type, t.active)
  })
);

export type AgentRow = typeof agents.$inferSelect;
export type AgentInsert = typeof agents.$inferInsert;
