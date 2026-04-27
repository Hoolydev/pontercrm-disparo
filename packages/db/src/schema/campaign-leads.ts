import type { CampaignLeadState } from "@pointer/shared";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.js";
import { createdAt, id } from "./_common.js";
import { leads } from "./leads.js";

export const campaignLeads = pgTable(
  "campaign_leads",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    state: text("state").$type<CampaignLeadState>().notNull().default("pending"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt()
  },
  (t) => ({
    campaignLeadUq: uniqueIndex("campaign_leads_campaign_lead_uq").on(t.campaignId, t.leadId),
    campaignStateIdx: index("campaign_leads_campaign_state_idx").on(t.campaignId, t.state)
  })
);

export type CampaignLeadRow = typeof campaignLeads.$inferSelect;
export type CampaignLeadInsert = typeof campaignLeads.$inferInsert;
