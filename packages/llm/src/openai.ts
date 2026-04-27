import OpenAI from "openai";
import type { ChatRequest, ChatResponse, LLMProvider } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  readonly kind = "openai" as const;
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await this.client.chat.completions.create({
      model: req.model,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) => ({ role: m.role as any, content: m.content }))
      ],
      tools: req.tools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))
    });

    const choice = res.choices[0];
    const toolCalls =
      choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParse(tc.function.arguments)
      })) ?? [];

    return {
      content: choice?.message?.content ?? "",
      toolCalls,
      usage: res.usage
        ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
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

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
