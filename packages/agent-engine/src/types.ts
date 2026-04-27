import type { Database } from "@pointer/db";
import type { ToolCall as LLMToolCall } from "@pointer/llm";
import type { ToolExecutionStatus } from "@pointer/shared";
import type { Redis } from "ioredis";

/**
 * Minimal structural logger interface — satisfied by both pino's `Logger` and
 * Fastify's `FastifyBaseLogger`, so callers can pass either without casts.
 */
export type EngineLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type AgentMode = "inbound" | "outbound";

export type RunTrigger = {
  kind: "webhook_inbound" | "campaign_seed" | "manual_resume" | "followup";
  refId?: string;
};

export type RunAgentInput = {
  conversationId: string;
  mode: AgentMode;
  firstTouch?: boolean;
  trigger: RunTrigger;
};

export type ToolExecutionRecord = {
  toolName: string;
  status: ToolExecutionStatus;
  result?: Record<string, unknown>;
  error?: string;
};

export type RunAgentResult = {
  status: "replied" | "paused_by_handoff" | "skipped" | "tool_only" | "error";
  messageId?: string;
  toolCallsExecuted: ToolExecutionRecord[];
  outboundEnqueued: boolean;
  reason?: string;
};

export type PreviewInput = {
  agentId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

export type PreviewResult = {
  content: string;
  toolCalls: LLMToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
};

// ─── Tools ─────────────────────────────────────────────────────────────────

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolHandlerContext = {
  conversationId: string;
  messageId: string;
  agentId: string | null;
  campaignId: string | null;
  args: Record<string, unknown>;
  db: Database;
  publisher: Redis;
  logger: EngineLogger;
};

export type ToolHandlerOutcome = {
  status: ToolExecutionStatus;
  result?: Record<string, unknown>;
  error?: string;
  /** True if this tool's execution should pause AI (ex: transfer_to_broker). */
  pausesAi?: boolean;
};

export type ToolHandler = (ctx: ToolHandlerContext) => Promise<ToolHandlerOutcome>;

export type ToolEntry = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

export type ToolRegistry = Record<string, ToolEntry>;

// ─── Engine deps ───────────────────────────────────────────────────────────

export type AgentEngineDeps = {
  db: Database;
  publisher: Redis;
  logger: EngineLogger;
  /** Override the default tool registry (mostly for tests / Phase C wiring). */
  tools?: ToolRegistry;
};

export interface AgentEngine {
  run(input: RunAgentInput): Promise<RunAgentResult>;
  preview(input: PreviewInput): Promise<PreviewResult>;
}
