import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_common.js";

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(), // "lead-source:zap", "whatsapp:uazapi", etc
    source: text("source"),
    dedupeKey: text("dedupe_key").notNull(),
    signature: text("signature"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt()
  },
  (t) => ({
    dedupeKeyUq: uniqueIndex("webhook_events_dedupe_key_uq").on(t.dedupeKey),
    providerIdx: index("webhook_events_provider_idx").on(t.provider, t.createdAt)
  })
);

export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type WebhookEventInsert = typeof webhookEvents.$inferInsert;
