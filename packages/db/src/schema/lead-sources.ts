import { boolean, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";

export const leadSources = pgTable(
  "lead_sources",
  {
    id: id(),
    type: text("type").notNull(), // e.g. "zap", "vivareal", "website", "manual"
    name: text("name").notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    active: boolean("active").notNull().default(true),
    configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    nameUq: uniqueIndex("lead_sources_name_uq").on(t.name)
  })
);

export type LeadSourceRow = typeof leadSources.$inferSelect;
export type LeadSourceInsert = typeof leadSources.$inferInsert;
