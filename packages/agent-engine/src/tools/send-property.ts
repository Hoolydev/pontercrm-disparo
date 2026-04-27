import { schema } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { newId, sha256 } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { ToolEntry } from "../types.js";

const CH_INBOX = "inbox:updates";

/**
 * Tool `send_property` — used by the agent to share a property "ficha" PDF
 * with the lead. The handler:
 *   1. Loads the property (validates it's active)
 *   2. Builds a PDF download URL (rendered on-demand by /properties/:id/pdf)
 *   3. Persists an outbound message with media_url + media_type='document'
 *   4. Enqueues outbound-message → worker calls provider.sendMedia()
 *
 * The agent may include a short caption to introduce the property.
 */
export const sendProperty: ToolEntry = {
  definition: {
    name: "send_property",
    description:
      "Envia ao lead um PDF com os detalhes de um imóvel do catálogo (fotos, descrição, preço). Use quando o lead demonstra interesse específico em um imóvel ou pede informações detalhadas.",
    parameters: {
      type: "object",
      properties: {
        property_id: {
          type: "string",
          description: "UUID do imóvel no catálogo (tabela properties)."
        },
        caption: {
          type: "string",
          description:
            "Mensagem curta para acompanhar o PDF (ex: 'Aqui está a ficha do imóvel que conversamos'). Opcional."
        }
      },
      required: ["property_id"]
    }
  },
  handler: async (ctx) => {
    const { conversationId, args, db, publisher, logger, messageId } = ctx;

    const propertyId =
      typeof args.property_id === "string" && args.property_id.length > 0
        ? args.property_id
        : null;
    if (!propertyId) {
      return { status: "error", error: "property_id required" };
    }

    const property = await db.query.properties.findFirst({
      where: eq(schema.properties.id, propertyId)
    });
    if (!property) return { status: "error", error: "property_not_found" };
    if (!property.active) {
      return { status: "error", error: "property_inactive" };
    }

    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
      columns: { id: true, whatsappInstanceId: true, assignedBrokerId: true }
    });
    if (!conv) return { status: "error", error: "conversation_not_found" };

    // PDF URL — generated on demand by /properties/:id/pdf
    const apiUrl = process.env.API_URL ?? "http://localhost:3333";
    const pdfUrl = `${apiUrl.replace(/\/$/, "")}/properties/${property.id}/pdf`;

    const captionText =
      typeof args.caption === "string" && args.caption.length > 0
        ? args.caption
        : `Segue a ficha do imóvel: ${property.title}`;

    // Persist outbound message linked to the same turn (different message_id
    // from the AI's text message — both belong to the same conversation).
    const mediaMsgId = newId();
    const contentHash = sha256(`property:${conversationId}:${propertyId}:${Date.now()}`);
    await db.insert(schema.messages).values({
      id: mediaMsgId,
      conversationId,
      direction: "out",
      senderType: "ai",
      content: captionText,
      contentHash,
      mediaUrl: pdfUrl,
      mediaType: "document",
      status: "queued",
      toolCalls: [{ name: "send_property", arguments: { property_id: propertyId } }]
    });

    // Enqueue outbound dispatch — worker handles provider.sendMedia. The
    // jobId makes BullMQ deduplicate retries, so a transient handler failure
    // doesn't end up sending the PDF twice.
    await getQueues().outboundMessage.add(
      `prop-${mediaMsgId}`,
      { messageId: mediaMsgId, conversationId },
      { delay: 1500, jobId: `prop-${mediaMsgId}` }
    );

    await publisher.publish(
      CH_INBOX,
      JSON.stringify({
        kind: "message:new",
        conversationId,
        messageId: mediaMsgId,
        senderType: "ai",
        brokerId: conv.assignedBrokerId
      })
    );

    logger.info(
      { conversationId, propertyId, messageId, mediaMsgId },
      "tool: send_property dispatched"
    );

    return {
      status: "ok",
      pausesAi: false,
      result: {
        propertyId,
        propertyTitle: property.title,
        mediaUrl: pdfUrl,
        caption: captionText
      }
    };
  }
};
