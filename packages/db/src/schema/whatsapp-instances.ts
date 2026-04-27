import type { InstanceStatus, WhatsappProvider } from "@pointer/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";

export const whatsappInstances = pgTable(
  "whatsapp_instances",
  {
    id: id(),
    provider: text("provider").$type<WhatsappProvider>().notNull(),
    externalId: text("external_id").notNull(),
    number: text("number").notNull(),
    status: text("status").$type<InstanceStatus>().notNull().default("pending"),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(20),
    messagesSentLastMinute: integer("messages_sent_last_minute").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    providerExternalUq: uniqueIndex("whatsapp_instances_provider_external_uq").on(
      t.provider,
      t.externalId
    ),
    activeLastUsedIdx: index("whatsapp_instances_active_last_used_idx")
      .on(t.active, t.lastUsedAt)
      .where(sql`${t.active} = true`)
  })
);

export type WhatsappInstanceRow = typeof whatsappInstances.$inferSelect;
export type WhatsappInstanceInsert = typeof whatsappInstances.$inferInsert;
