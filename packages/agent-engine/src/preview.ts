import { schema } from "@pointer/db";
import { getLLMForModel } from "@pointer/llm";
import type { ToolDef } from "@pointer/llm";
import { eq } from "drizzle-orm";
import { builtInTools } from "./tools/index.js";
import type {
  AgentEngineDeps,
  PreviewInput,
  PreviewResult,
  ToolEntry,
  ToolRegistry
} from "./types.js";

/**
 * Synchronous LLM call against an agent's prompt + tools, with no DB writes,
 * no lock, no outbound dispatch. Used by the playground route.
 */
export async function previewAgent(
  deps: AgentEngineDeps,
  input: PreviewInput
): Promise<PreviewResult> {
  const { db } = deps;
  const registry: ToolRegistry = deps.tools ?? builtInTools;

  const agent = await db.query.agents.findFirst({
    where: eq(schema.agents.id, input.agentId)
  });
  if (!agent) throw new Error(`agent ${input.agentId} not found`);

  const behavior = agent.behaviorJson ?? {};
  const enabled = behavior.tools_enabled ?? [];
  const toolEntries: ToolEntry[] = enabled.length
    ? enabled.map((n) => registry[n]).filter((e): e is ToolEntry => Boolean(e))
    : Object.values(registry);
  const tools: ToolDef[] = toolEntries.map((t) => t.definition);

  const llm = await getLLMForModel(agent.model);
  const res = await llm.chat({
    model: agent.model,
    system: agent.systemPrompt,
    messages: input.messages,
    tools: tools.length ? tools : undefined,
    temperature: behavior.temperature ?? 0.7,
    maxTokens: behavior.max_tokens ?? 512
  });

  return { content: res.content, toolCalls: res.toolCalls, usage: res.usage };
}
