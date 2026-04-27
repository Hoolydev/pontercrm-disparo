import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.js";
import { createdAt, id } from "./_common.js";

/**
 * Files attached to a campaign — PDFs, videos, photos. Reusable assets that
 * the campaign's AI agents can reference when responding to leads.
 *
 * The agent at runtime sees BOTH `agent_attachments` AND
 * `campaign_attachments` (when the conversation has a campaign), via system
 * prompt enrichment with their URLs + captions.
 */
export const campaignAttachments = pgTable(
  "campaign_attachments",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /** 'image' | 'video' | 'document' */
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    url: text("url").notNull(),
    caption: text("caption"),
    createdAt: createdAt()
  },
  (t) => ({
    campaignIdx: index("campaign_attachments_campaign_idx").on(t.campaignId)
  })
);

export type CampaignAttachmentRow = typeof campaignAttachments.$inferSelect;
export type CampaignAttachmentInsert = typeof campaignAttachments.$inferInsert;
