export type InboundMessageJob = {
  webhookEventId: string;
  provider: string;
  instanceId: string;
  fromPhone: string;
  content: string;
  mediaUrl?: string;
  providerMessageId: string;
  receivedAt: string; // ISO
};

export type AiReplyTrigger = {
  kind: "webhook_inbound" | "campaign_seed" | "manual_resume" | "followup";
  refId?: string;
};

export type AiReplyJob = {
  conversationId: string;
  /** 'inbound' = lead replied; 'outbound' = we're initiating contact (campaign seed). */
  mode?: "inbound" | "outbound";
  firstTouch?: boolean;
  trigger?: AiReplyTrigger;
  /** Free-form audit string (kept for backwards-compat with Phase A enqueues). */
  reason?: string;
};

export type OutboundMessageJob = {
  messageId: string;
  conversationId: string;
};

export type HandoffEvaluatorJob = {
  conversationId: string;
  lastLeadMessageId?: string;
  lastAiMessageId?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
};

export type BrokerNotifyJob = {
  brokerId: string;
  conversationId: string;
  kind: "handoff" | "new_message" | "followup" | "redistribute" | "sla" | "system";
  message?: string;
};

export type MemorySummarizeJob = {
  conversationId: string;
};

export type FollowupJob = {
  conversationId: string;
  reason: string;
};

export type OutboundBlastSeederJob = {
  campaignId: string;
};

export type OutboundBlastJob = {
  campaignId: string;
  campaignLeadId: string;
};

export type FollowupProcessorJob = {
  /** Tick triggered by the recurring scheduler. No payload needed. */
  tick?: number;
};

export type DistributionWatchdogJob = {
  tick?: number;
};

export type ScoreSweepJob = {
  /** Either '24h' or '7d'. */
  window: "24h" | "7d";
};

export type SlaAlertsSweepJob = {
  tick?: number;
};
