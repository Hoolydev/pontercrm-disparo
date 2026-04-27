import type { WhatsappProvider } from "@pointer/shared";

export type OutboundText = {
  to: string; // E.164
  text: string;
};

export type OutboundMedia = {
  to: string;
  mediaUrl: string;
  caption?: string;
  kind: "image" | "audio" | "video" | "document";
};

export type SendResult = {
  providerMessageId: string;
};

export type IncomingMessage = {
  providerMessageId: string;
  fromPhone: string; // E.164
  instanceExternalId: string;
  content: string;
  mediaUrl?: string;
  timestamp: Date;
  raw: unknown;
};

export type StatusUpdate = {
  providerMessageId: string;
  status: "delivered" | "read" | "failed";
  raw: unknown;
};

export type ParsedWebhook =
  | { kind: "message"; message: IncomingMessage }
  | { kind: "status"; update: StatusUpdate }
  | { kind: "ignored" };

export interface WhatsAppProvider {
  readonly kind: WhatsappProvider;
  sendText(input: OutboundText, config: ProviderConfig): Promise<SendResult>;
  sendMedia(input: OutboundMedia, config: ProviderConfig): Promise<SendResult>;
  parseWebhook(payload: unknown, headers: Record<string, string>): ParsedWebhook;
  verifySignature(
    payload: string,
    headers: Record<string, string>,
    config: ProviderConfig
  ): boolean;
}

export type ProviderConfig = {
  baseUrl?: string;
  token?: string;
  webhookSecret?: string;
  [k: string]: unknown;
};
