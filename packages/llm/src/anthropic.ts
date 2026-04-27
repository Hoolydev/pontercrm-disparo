import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResponse, LLMProvider } from "./types.js";

export class AnthropicProvider implements LLMProvider {
  readonly kind = "anthropic" as const;
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await this.client.messages.create({
      model: req.model,
      system: req.system,
      temperature: req.temperature,
      max_tokens: req.maxTokens ?? 1024,
      messages: req.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      tools: req.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as any
      }))
    });

    let content = "";
    const toolCalls: ChatResponse["toolCalls"] = [];
    for (const block of res.content) {
      if (block.type === "text") content += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: res.usage
        ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }
        : undefined
    };
  }

  async classify(req: { model: string; system: string; input: string; labels: string[] }) {
    const res = await this.chat({
      model: req.model,
      system: `${req.system}\n\nResponda APENAS com uma das labels: ${req.labels.join(", ")}.`,
      messages: [{ role: "user", content: req.input }],
      temperature: 0,
      maxTokens: 10
    });
    const text = res.content.trim().toLowerCase();
    return req.labels.find((l) => text.includes(l.toLowerCase())) ?? req.labels[0]!;
  }
}
