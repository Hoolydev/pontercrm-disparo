import type { LLMProvider } from "./types.js";

export async function getLLMForModel(model: string): Promise<LLMProvider> {
  if (model.startsWith("gpt") || model.startsWith("o")) {
    const { OpenAIProvider } = await import("./openai.js");
    return new OpenAIProvider();
  }
  if (model.startsWith("claude")) {
    const { AnthropicProvider } = await import("./anthropic.js");
    return new AnthropicProvider();
  }
  throw new Error(`Unknown model family: ${model}`);
}
