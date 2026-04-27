// Redis pub/sub channel names for SSE event fan-out between worker and API.
export const CH = {
  inbox: "inbox:updates",
  conversation: (id: string) => `conv:${id}:events`
} as const;

export type InboxEvent =
  | { kind: "message:new"; conversationId: string; messageId: string; senderType: string }
  | { kind: "conversation:update"; conversationId: string; status: string; aiPaused: boolean }
  | { kind: "handoff"; conversationId: string; brokerId: string; reason: string };
