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

/**
 * Per-slot mapping for a Meta-approved template's {{1}}, {{2}}, ... params.
 * The outbound first-touch worker walks this array in order and substitutes
 * each entry into the corresponding {{N}} of the template body.
 *
 * - `field`: pulls a value from lead/campaign — name, phone, propertyRef,
 *   origin, campaign.
 * - `literal`: a fixed string. Useful for a static greeting prefix.
 */
export type MetaTemplateParamSpec =
  | { source: "field"; field: "name" | "phone" | "propertyRef" | "origin" | "campaign" }
  | { source: "literal"; value: string };

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
    /**
     * Meta Cloud API native template (HSM) used as the very first outbound
     * message when the conversation is sent through a `meta` provider
     * instance. Required by Meta whenever there's no 24h window open.
     * `metaTemplateName` is the template name as registered (and approved)
     * in the WhatsApp Manager; `metaTemplateLanguage` is e.g. "pt_BR";
     * `metaTemplateParamMap` describes how to fill {{1}}, {{2}}, ....
     * If unset, Meta-provider seeds fall back to plain text — which Meta
     * will reject outside the 24h window.
     */
    metaTemplateName: text("meta_template_name"),
    metaTemplateLanguage: text("meta_template_language"),
    metaTemplateParamMap: jsonb("meta_template_param_map").$type<MetaTemplateParamSpec[]>(),
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
