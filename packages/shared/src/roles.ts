export const ROLES = ["admin", "supervisor", "broker"] as const;
export type Role = (typeof ROLES)[number];

export const CONVERSATION_STATUS = ["ai_active", "handed_off", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUS)[number];

export const CONVERSATION_MODE = ["inbound", "outbound_seed", "outbound"] as const;
export type ConversationMode = (typeof CONVERSATION_MODE)[number];

export const MESSAGE_DIRECTION = ["in", "out"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTION)[number];

export const SENDER_TYPE = ["lead", "ai", "broker", "system"] as const;
export type SenderType = (typeof SENDER_TYPE)[number];

export const MESSAGE_STATUS = ["queued", "sent", "delivered", "read", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[number];

export const MEDIA_TYPE = ["image", "video", "audio", "document", "sticker"] as const;
export type MediaType = (typeof MEDIA_TYPE)[number];

export const WHATSAPP_PROVIDER = ["uazapi", "meta", "evolution"] as const;
export type WhatsappProvider = (typeof WHATSAPP_PROVIDER)[number];

export const INSTANCE_STATUS = ["connected", "disconnected", "banned", "pending"] as const;
export type InstanceStatus = (typeof INSTANCE_STATUS)[number];

export const TRIGGER_PATTERN_TYPE = ["keyword", "regex", "llm_classifier", "tool_call"] as const;
export type TriggerPatternType = (typeof TRIGGER_PATTERN_TYPE)[number];

export const TRIGGER_ACTION = ["assign_broker", "pause_ai", "notify"] as const;
export type TriggerAction = (typeof TRIGGER_ACTION)[number];

export const AGENT_TYPE = ["inbound", "outbound"] as const;
export type AgentType = (typeof AGENT_TYPE)[number];

export const STAGE_CATEGORY = ["open", "won", "lost"] as const;
export type StageCategory = (typeof STAGE_CATEGORY)[number];

export const CAMPAIGN_STATUS = ["draft", "active", "paused", "archived"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUS)[number];

export const CAMPAIGN_LEAD_STATE = [
  "pending",
  "queued",
  "dispatched",
  "replied",
  "failed",
  "skipped"
] as const;
export type CampaignLeadState = (typeof CAMPAIGN_LEAD_STATE)[number];

export const APPOINTMENT_STATUS = [
  "scheduled",
  "confirmed",
  "done",
  "cancelled",
  "no_show"
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[number];

export const APPOINTMENT_SOURCE = ["ai_tool", "manual"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCE)[number];

export const TOOL_EXECUTION_STATUS = ["ok", "error", "duplicate"] as const;
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUS)[number];

export const FOLLOWUP_STEP = [
  "broker_30min",
  "broker_24h",
  "broker_48h",
  "broker_5d",
  "redistribute_15d"
] as const;
export type FollowupStep = (typeof FOLLOWUP_STEP)[number];

export const FOLLOWUP_STATUS = ["pending", "sent", "skipped", "done", "cancelled"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUS)[number];

export const FOLLOWUP_STEP_OFFSET_MS: Record<FollowupStep, number> = {
  broker_30min: 30 * 60_000,
  broker_24h: 24 * 60 * 60_000,
  broker_48h: 48 * 60 * 60_000,
  broker_5d: 5 * 24 * 60 * 60_000,
  redistribute_15d: 15 * 24 * 60 * 60_000
};

export const BROKER_QUEUE_STATUS = ["pending", "accepted", "timeout", "reassigned"] as const;
export type BrokerQueueStatus = (typeof BROKER_QUEUE_STATUS)[number];

export const LEAD_CLASSIFICATION = ["cold", "warm", "hot"] as const;
export type LeadClassification = (typeof LEAD_CLASSIFICATION)[number];

export const LEAD_SCORE_THRESHOLDS = { warm: 10, hot: 30 } as const;

export function classifyScore(score: number): LeadClassification {
  if (score >= LEAD_SCORE_THRESHOLDS.hot) return "hot";
  if (score >= LEAD_SCORE_THRESHOLDS.warm) return "warm";
  return "cold";
}
