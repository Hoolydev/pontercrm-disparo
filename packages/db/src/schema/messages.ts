import type { MediaType, MessageDirection, MessageStatus, SenderType } from "@pointer/shared";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { createdAt, id, updatedAt } from "./_common.js";
import { whatsappInstances } from "./whatsapp-instances.js";

export type ToolCallRecord = {
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * When set, the outbound worker dispatches this message as a Meta Cloud API
 * `type: "template"` payload instead of plain text. `content` still carries
 * the rendered preview (so the inbox shows what was sent), but the wire
 * format used against Graph API is the structured template payload.
 */
export type MetaTemplateMessagePayload = {
  name: string;
  language: string;
  /** Already-resolved values for the BODY component, in slot order. */
  bodyParams: string[];
  /** Optional `parameter_name` per slot — required for named templates. */
  bodyParamNames?: string[];
  /** Optional non-text HEADER (video/image/document). */
  header?: {
    type: "video" | "image" | "document";
    link?: string;
    mediaId?: string;
  };
};

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction").$type<MessageDirection>().notNull(),
    senderType: text("sender_type").$type<SenderType>().notNull(),
    instanceId: uuid("instance_id").references(() => whatsappInstances.id, {
      onDelete: "set null"
    }),
    content: text("content").notNull().default(""),
    mediaUrl: text("media_url"),
    mediaType: text("media_type").$type<MediaType>(),
    contentHash: text("content_hash").notNull(),
    providerMessageId: text("provider_message_id"),
    status: text("status").$type<MessageStatus>().notNull().default("queued"),
    toolCalls: jsonb("tool_calls").$type<ToolCallRecord[]>(),
    metaTemplatePayload: jsonb("meta_template_payload_json").$type<MetaTemplateMessagePayload>(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    conversationCreatedIdx: index("messages_conversation_created_idx").on(
      t.conversationId,
      t.createdAt
    ),
    hashIdx: index("messages_hash_idx").on(t.contentHash, t.conversationId),
    providerIdIdx: index("messages_provider_id_idx").on(t.providerMessageId)
  })
);

export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
