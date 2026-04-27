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

export class EvolutionProvider implements WhatsAppProvider {
  readonly kind = "evolution" as const;

  async sendText(input: OutboundText, config: ProviderConfig): Promise<SendResult> {
    const baseUrl = (config.baseUrl as string).replace(/\/$/, "");
    const instanceName = config.instanceName as string;
    const apiKey = config.token as string;

    const res = await request(`${baseUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        number: input.to.replace(/\D/g, ""),
        options: { delay: 0, presence: "composing" },
        textMessage: { text: input.text }
      })
    });
    const body = (await res.body.json()) as any;
    const msgId = body?.key?.id ?? body?.messageId ?? body?.id;
    if (!msgId) throw new Error(`Evolution sendText failed: ${JSON.stringify(body)}`);
    return { providerMessageId: msgId };
  }

  async sendMedia(input: OutboundMedia, config: ProviderConfig): Promise<SendResult> {
    const baseUrl = (config.baseUrl as string).replace(/\/$/, "");
    const instanceName = config.instanceName as string;
    const apiKey = config.token as string;

    const typeMap: Record<string, string> = {
      image: "image",
      audio: "audio",
      video: "video",
      document: "document"
    };

    const res = await request(`${baseUrl}/message/sendMedia/${instanceName}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        number: input.to.replace(/\D/g, ""),
        options: { delay: 0 },
        mediaMessage: {
          mediatype: typeMap[input.kind] ?? "document",
          media: input.mediaUrl,
          caption: input.caption ?? ""
        }
      })
    });
    const body = (await res.body.json()) as any;
    const msgId = body?.key?.id ?? body?.messageId ?? body?.id;
    if (!msgId) throw new Error(`Evolution sendMedia failed: ${JSON.stringify(body)}`);
    return { providerMessageId: msgId };
  }

  parseWebhook(payload: unknown, _headers: Record<string, string>): ParsedWebhook {
    const p = payload as any;
    const event = p?.event ?? p?.type ?? "";

    if (event === "messages.upsert" || event === "message") {
      const data = p?.data ?? p;
      const key = data?.key ?? {};
      const msg = data?.message ?? {};
      if (key.fromMe) return { kind: "ignored" };

      const remoteJid: string = key.remoteJid ?? "";
      const fromPhone = remoteJid.replace(/@.*/, "").replace(/^(\d)/, "+$1");
      const content =
        msg?.conversation ??
        msg?.extendedTextMessage?.text ??
        msg?.imageMessage?.caption ??
        msg?.videoMessage?.caption ??
        msg?.documentMessage?.caption ??
        "[media]";

      const msgId = key.id ?? data?.messageId ?? data?.id;
      if (!msgId) return { kind: "ignored" };

      const incoming: IncomingMessage = {
        providerMessageId: msgId,
        fromPhone,
        instanceExternalId: p?.instance ?? data?.instanceName ?? "",
        content,
        timestamp: data?.messageTimestamp
          ? new Date(Number(data.messageTimestamp) * 1000)
          : new Date(),
        raw: p
      };
      return { kind: "message", message: incoming };
    }

    if (event === "messages.update" || event === "message.update") {
      const update = p?.data?.[0] ?? p?.data ?? p;
      const statusRaw = update?.update?.status ?? update?.status ?? "";
      const statusMap: Record<string, StatusUpdate["status"]> = {
        DELIVERY_ACK: "delivered",
        READ: "read",
        PLAYED: "read",
        ERROR: "failed"
      };
      const mapped = statusMap[statusRaw];
      if (mapped) {
        return {
          kind: "status",
          update: {
            providerMessageId: update?.key?.id ?? update?.id ?? "",
            status: mapped,
            raw: update
          }
        };
      }
    }

    return { kind: "ignored" };
  }

  verifySignature(
    payload: string,
    headers: Record<string, string>,
    config: ProviderConfig
  ): boolean {
    const secret = config.webhookSecret as string | undefined;
    if (!secret) return true; // Evolution doesn't require HMAC by default
    const sig = headers["x-evolution-signature"] ?? "";
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
