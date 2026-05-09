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

export type OutboundTemplate = {
  to: string;
  name: string;
  language: string;
  /**
   * Already-resolved values for the BODY component, in the order they appear
   * in the template body. For positional templates (`{{1}}`, `{{2}}`) just
   * supply texts. For named templates (`{{nome}}`), also pass `bodyParamNames`
   * with the matching `parameter_name` per slot.
   */
  bodyParams: string[];
  /**
   * Optional `parameter_name` per slot, same length as `bodyParams`. When
   * present, the provider stamps `parameter_name` on each Meta parameter
   * object — required for templates approved with named placeholders.
   */
  bodyParamNames?: string[];
  /**
   * Optional non-text HEADER. When set, the provider materializes the
   * header component on the wire payload.
   */
  header?: {
    type: "video" | "image" | "document";
    /** Public HTTPS URL OR a media id from `POST /media`. */
    link?: string;
    mediaId?: string;
  };
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
  /** Optional. Only Meta supports native HSM templates today. */
  sendTemplate?(input: OutboundTemplate, config: ProviderConfig): Promise<SendResult>;
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
