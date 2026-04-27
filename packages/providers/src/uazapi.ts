import { request } from "undici";
import type {
  OutboundMedia,
  OutboundText,
  ParsedWebhook,
  ProviderConfig,
  SendResult,
  WhatsAppProvider
} from "./types.js";

// Minimal Uazapi adapter. Endpoints based on common Uazapi conventions;
// adjust when connecting to a real instance if the deployment uses different routes.
export class UazapiProvider implements WhatsAppProvider {
  readonly kind = "uazapi" as const;

  async sendText(input: OutboundText, config: ProviderConfig): Promise<SendResult> {
    const res = await this.post("/send/text", config, {
      number: toUazapiNumber(input.to),
      text: input.text
    });
    const providerMessageId =
      res?.messageId ?? res?.key?.id ?? res?.id ?? `uazapi-${Date.now()}`;
    return { providerMessageId: String(providerMessageId) };
  }

  async sendMedia(input: OutboundMedia, config: ProviderConfig): Promise<SendResult> {
    const res = await this.post("/send/media", config, {
      number: toUazapiNumber(input.to),
      // Uazapi expects field "type" + "file" (not "mediatype" + "url").
      type: input.kind,
      file: input.mediaUrl,
      caption: input.caption
    });
    const providerMessageId =
      res?.messageId ?? res?.key?.id ?? res?.id ?? `uazapi-${Date.now()}`;
    return { providerMessageId: String(providerMessageId) };
  }

  parseWebhook(payload: unknown): ParsedWebhook {
    const data = payload as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return { kind: "ignored" };

    const event = (data.event ?? data.type) as string | undefined;
    if (event === "message" || event === "messages.upsert") {
      const msg = (data.message ?? data.data) as Record<string, unknown> | undefined;
      if (!msg) return { kind: "ignored" };

      const fromRaw = (msg.from ?? msg.sender ?? msg.remoteJid) as string | undefined;
      const content = (msg.text ?? msg.body ?? msg.caption ?? "") as string;
      const id = (msg.id ?? msg.messageId ?? msg.key) as string | undefined;
      const instanceExternalId = (data.instance ?? data.instanceId ?? "") as string;
      const ts = (msg.timestamp ?? msg.t ?? Date.now()) as number;

      if (!fromRaw || !id) return { kind: "ignored" };

      return {
        kind: "message",
        message: {
          providerMessageId: String(id),
          fromPhone: normalize(fromRaw),
          instanceExternalId,
          content,
          mediaUrl: (msg.mediaUrl ?? msg.url) as string | undefined,
          timestamp: new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts),
          raw: payload
        }
      };
    }

    if (event === "status" || event === "messages.update") {
      const upd = (data.status ?? data.data) as Record<string, unknown> | undefined;
      const id = upd?.id as string | undefined;
      const s = (upd?.status ?? "") as string;
      if (!id) return { kind: "ignored" };
      const mapped: "delivered" | "read" | "failed" =
        s === "DELIVERY_ACK" || s === "delivered"
          ? "delivered"
          : s === "READ" || s === "read"
            ? "read"
            : "failed";
      return { kind: "status", update: { providerMessageId: id, status: mapped, raw: payload } };
    }

    return { kind: "ignored" };
  }

  verifySignature(): boolean {
    // Uazapi self-hosted signatures vary by deployment; rely on the per-instance
    // webhookSecret being passed through a header the API route validates against
    // `whatsapp_instances.configJson.webhookSecret`. We keep this permissive and
    // do the check at the HTTP layer (apps/api/src/plugins/hmac.ts).
    return true;
  }

  private async post(path: string, config: ProviderConfig, body: unknown): Promise<any> {
    const baseUrl = config.baseUrl;
    const token = config.token;
    if (!baseUrl) throw new Error("uazapi: missing baseUrl in config");
    if (!token) throw new Error("uazapi: missing token in config");

    const { statusCode, body: res } = await request(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        token
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    if (statusCode >= 400) {
      throw new Error(`uazapi ${path} failed: ${statusCode} ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function normalize(raw: string): string {
  const digits = raw.replace(/@.*$/, "").replace(/\D/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

/**
 * Uazapi `number` field requires digits-only with country code: `5511999999999`.
 * We accept any input shape (E.164 with `+`, parens, spaces) and strip to
 * just digits. Defensive — even though leads.phone is stored E.164, this
 * guards against any path that bypassed normalizeE164.
 */
function toUazapiNumber(to: string): string {
  return to.replace(/\D/g, "");
}
