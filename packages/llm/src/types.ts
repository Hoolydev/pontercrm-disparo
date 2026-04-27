export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
};

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatResponse = {
  content: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
};

export interface LLMProvider {
  readonly kind: "openai" | "anthropic";
  chat(req: ChatRequest): Promise<ChatResponse>;
  classify(req: {
    model: string;
    system: string;
    input: string;
    labels: string[];
  }): Promise<string>;
}
