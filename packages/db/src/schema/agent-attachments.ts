import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { createdAt, id } from "./_common.js";

/**
 * Files attached to an agent — PDFs, videos, photos. Used as canned media the
 * agent can reference (FAQ doc, brand video, intro photos). Different concept
 * from per-property photos, which live in `properties.photos_json`.
 */
export const agentAttachments = pgTable(
  "agent_attachments",
  {
    id: id(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** 'image' | 'video' | 'document' */
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Relative path inside storage root. */
    storagePath: text("storage_path").notNull(),
    /** Public URL the agent can reference when sending. */
    url: text("url").notNull(),
    /** Caption used by default when the agent sends this attachment. */
    caption: text("caption"),
    createdAt: createdAt()
  },
  (t) => ({
    agentIdx: index("agent_attachments_agent_idx").on(t.agentId)
  })
);

export type AgentAttachmentRow = typeof agentAttachments.$inferSelect;
export type AgentAttachmentInsert = typeof agentAttachments.$inferInsert;
