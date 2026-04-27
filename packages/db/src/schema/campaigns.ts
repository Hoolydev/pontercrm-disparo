import type { CampaignStatus } from "@pointer/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { createdAt, id, updatedAt } from "./_common.js";
import { pipelines } from "./pipelines.js";
import { users } from "./users.js";

export type CampaignSettings = {
  delay_range_ms?: [number, number];
  max_messages_per_minute?: number;
  /** Min seconds between consecutive messages to the SAME lead — anti-spam guard. */
  min_seconds_between_messages_per_lead?: number;
  send_media?: boolean;
  followup_enabled?: boolean;
  business_hours?: {
    start: string; // "HH:MM"
    end: string;
    tz: string; // IANA, e.g. "America/Sao_Paulo"
  };
};

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    name: text("name").notNull(),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    outboundAgentId: uuid("outbound_agent_id").references(() => agents.id, {
      onDelete: "restrict"
    }),
    inboundAgentId: uuid("inbound_agent_id").references(() => agents.id, {
      onDelete: "restrict"
    }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    settingsJson: jsonb("settings_json").$type<CampaignSettings>().notNull().default({}),
    /**
     * Optional first message template for outbound campaigns. When set, the
     * first AI turn for each lead skips the LLM and sends this text verbatim
     * after substituting `{{name}}`, `{{phone}}`, `{{property_ref}}`,
     * `{{origin}}`, `{{campaign}}`. Lower latency, deterministic, cheaper.
     * AI takes over normally on the lead's reply.
     */
    firstMessageTemplate: text("first_message_template"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    activeIdx: index("campaigns_active_idx")
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
    pipelineIdx: index("campaigns_pipeline_idx").on(t.pipelineId)
  })
);

export type CampaignRow = typeof campaigns.$inferSelect;
export type CampaignInsert = typeof campaigns.$inferInsert;
