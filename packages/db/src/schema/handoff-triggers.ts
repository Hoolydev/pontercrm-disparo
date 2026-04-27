import type { TriggerAction, TriggerPatternType } from "@pointer/shared";
import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { createdAt, id, updatedAt } from "./_common.js";

export const handoffTriggers = pgTable(
  "handoff_triggers",
  {
    id: id(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    patternType: text("pattern_type").$type<TriggerPatternType>().notNull(),
    pattern: text("pattern").notNull(),
    action: text("action").$type<TriggerAction>().notNull().default("pause_ai"),
    priority: integer("priority").notNull().default(100),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    agentPriorityIdx: index("handoff_triggers_agent_priority_idx").on(t.agentId, t.priority)
  })
);

export type HandoffTriggerRow = typeof handoffTriggers.$inferSelect;
export type HandoffTriggerInsert = typeof handoffTriggers.$inferInsert;
