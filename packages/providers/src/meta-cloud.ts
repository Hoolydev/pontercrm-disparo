import { createHmac, timingSafeEqual } from "node:crypto";
import { request } from "undici";
import type {
  IncomingMessage,
  OutboundMedia,
  OutboundText,
  ParsedWebhook,
  ProviderConfig,
  SendResult,
  StatusUpdate
} from "./types.js";
import type { WhatsAppProvider } from "./types.js";

const GRAPH_API = "https://graph.facebook.com/v19.0";

export class MetaCloudProvider implements WhatsAppProvider {
  readonly kind = "meta" as const;

  async sendText(input: OutboundText, config: ProviderConfig): Promise<SendResult> {
    const phoneNumberId = config.phoneNumberId as string;
    const accessToken = config.token as string;
    const res = await request(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.text }
      })
    });
    const body = (await res.body.json()) as any;
    const msgId = body?.messages?.[0]?.id;
    if (!msgId) throw new Error(`Meta send failed: ${JSON.stringify(body)}`);
    return { providerMessageId: msgId };
  }

  async sendMedia(input: OutboundMedia, config: ProviderConfig): Promise<SendResult> {
    const phoneNumberId = config.phoneNumberId as string;
    const accessToken = config.token as string;
    const typeMap: Record<string, string> = {
      image: "image",
      audio: "audio",
      video: "video",
      document: "document"
    };
    const res = await request(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: typeMap[input.kind] ?? "document",
        [typeMap[input.kind] ?? "document"]: {
          link: input.mediaUrl,
          ...(input.caption ? { caption: input.caption } : {})
        }
      })
    });
    const body = (await res.body.json()) as any;
    const msgId = body?.messages?.[0]?.id;
    if (!msgId) throw new Error(`Meta sendMedia failed: ${JSON.stringify(body)}`);
    return { providerMessageId: msgId };
  }

  parseWebhook(payload: unknown, _headers: Record<string, string>): ParsedWebhook {
    const p = payload as any;
    if (p?.object !== "whatsapp_business_account") return { kind: "ignored" };

    const entry = p?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value) return { kind: "ignored" };

    // Status update
    const statusEntry = value?.statuses?.[0];
    if (statusEntry) {
      const statusMap: Record<string, StatusUpdate["status"]> = {
        delivered: "delivered",
        read: "read",
        failed: "failed"
      };
      const mapped = statusMap[statusEntry.status];
      if (mapped) {
        return {
          kind: "status",
          update: {
            providerMessageId: statusEntry.id,
            status: mapped,
            raw: statusEntry
          }
        };
      }
      return { kind: "ignored" };
    }

    // Incoming message
    const msg = value?.messages?.[0];
    if (!msg) return { kind: "ignored" };

    const fromPhone = msg.from?.startsWith("+") ? msg.from : `+${msg.from}`;
    let content = "";
    let mediaUrl: string | undefined;

    if (msg.type === "text") {
      content = msg.text?.body ?? "";
    } else if (["image", "audio", "video", "document"].includes(msg.type)) {
      const mediaObj = msg[msg.type];
      content = mediaObj?.caption ?? `[${msg.type}]`;
      mediaUrl = mediaObj?.id ? `meta-media:${mediaObj.id}` : undefined;
    } else {
      content = `[${msg.type}]`;
    }

    const incoming: IncomingMessage = {
      providerMessageId: msg.id,
      fromPhone,
      instanceExternalId: value.metadata?.phone_number_id ?? "",
      content,
      mediaUrl,
      timestamp: new Date(Number(msg.timestamp) * 1000),
      raw: msg
    };
    return { kind: "message", message: incoming };
  }

  verifySignature(
    payload: string,
    headers: Record<string, string>,
    config: ProviderConfig
  ): boolean {
    const appSecret = config.appSecret as string | undefined;
    if (!appSecret) return false;
    const sig = headers["x-hub-signature-256"] ?? "";
    const expected = `sha256=${createHmac("sha256", appSecret).update(payload).digest("hex")}`;
    try {
      return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
