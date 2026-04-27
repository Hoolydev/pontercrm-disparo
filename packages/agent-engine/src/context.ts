import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import type { ChatMessage } from "@pointer/llm";
import { desc, eq } from "drizzle-orm";
import type { AgentMode } from "./types.js";

type ConversationWithRels = NonNullable<
  Awaited<ReturnType<Database["query"]["conversations"]["findFirst"]>>
> & {
  lead: NonNullable<Awaited<ReturnType<Database["query"]["leads"]["findFirst"]>>>;
  agent: NonNullable<Awaited<ReturnType<Database["query"]["agents"]["findFirst"]>>> | null;
  campaign:
    | NonNullable<Awaited<ReturnType<Database["query"]["campaigns"]["findFirst"]>>>
    | null;
  memory:
    | NonNullable<Awaited<ReturnType<Database["query"]["conversationMemory"]["findFirst"]>>>
    | null;
};

export type LoadedContext = {
  conv: ConversationWithRels;
  systemPrompt: string;
  history: ChatMessage[];
  /** First-touch synthetic message injected when conversation has no prior turns. */
  firstTouchUser?: ChatMessage;
};

/**
 * Loads everything the LLM call needs in one place:
 * - Conversation with lead/agent/campaign/memory
 * - Recent N messages (filtered to lead/ai turns) in chronological order
 * - System prompt enriched with [CONTEXTO] block (lead, campaign, stage)
 *
 * Mode is informational at this layer — caller is expected to have already
 * resolved which agent (inbound vs outbound) was chosen for this turn.
 */
export async function loadContext(opts: {
  db: Database;
  conversationId: string;
  mode: AgentMode;
  firstTouch?: boolean;
}): Promise<LoadedContext | null> {
  const { db, conversationId, mode, firstTouch } = opts;

  const conv = (await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversationId),
    with: { lead: true, agent: true, campaign: true, memory: true }
  })) as ConversationWithRels | undefined;

  if (!conv || !conv.agent) return null;

  const behavior = conv.agent.behaviorJson ?? {};
  const maxHistory = behavior.max_history_messages ?? 10;

  const recent = await db.query.messages.findMany({
    where: eq(schema.messages.conversationId, conversationId),
    orderBy: [desc(schema.messages.createdAt)],
    limit: maxHistory
  });

  const history: ChatMessage[] = recent
    .reverse()
    .filter((m) => m.senderType === "lead" || m.senderType === "ai")
    .map((m) => ({
      role: m.senderType === "lead" ? "user" : "assistant",
      content: m.content
    }));

  // Optional pipeline stage info for context
  let stageName: string | null = null;
  if (conv.lead.pipelineStageId) {
    const stage = await db.query.pipelineStages.findFirst({
      where: eq(schema.pipelineStages.id, conv.lead.pipelineStageId),
      columns: { name: true }
    });
    stageName = stage?.name ?? null;
  }

  const summary = conv.memory?.summary ?? "";

  // Pull attachments available to this conversation: agent's own + campaign's.
  const [agentAtts, campaignAtts] = await Promise.all([
    db.query.agentAttachments.findMany({
      where: eq(schema.agentAttachments.agentId, conv.agent.id),
      columns: { kind: true, filename: true, url: true, caption: true }
    }),
    conv.campaignId
      ? db.query.campaignAttachments.findMany({
          where: eq(schema.campaignAttachments.campaignId, conv.campaignId),
          columns: { kind: true, filename: true, url: true, caption: true }
        })
      : Promise.resolve([] as Array<{ kind: string; filename: string; url: string; caption: string | null }>)
  ]);

  const blocks: string[] = [conv.agent.systemPrompt];

  const ctxParts: string[] = [];
  if (conv.lead.name) ctxParts.push(`Lead: ${conv.lead.name}`);
  if (conv.lead.propertyRef) ctxParts.push(`Imóvel de interesse: ${conv.lead.propertyRef}`);
  if (conv.lead.origin) ctxParts.push(`Origem: ${conv.lead.origin}`);
  if (stageName) ctxParts.push(`Funil: ${stageName}`);
  if (conv.campaign?.name) ctxParts.push(`Campanha: ${conv.campaign.name}`);
  if (mode === "outbound") ctxParts.push(`Modo: abordagem outbound (primeiro contato Pointer→lead)`);
  if (ctxParts.length) blocks.push(`[CONTEXTO]\n${ctxParts.join("\n")}`);

  // Inform the agent of available media (it cannot send these directly via
  // text — but it can mention them in a reply, and the send_property tool
  // exists for property PDFs).
  if (agentAtts.length || campaignAtts.length) {
    const lines = [
      ...agentAtts.map((a) => `- [agente] ${a.kind}: ${a.filename}${a.caption ? ` — ${a.caption}` : ""} (${a.url})`),
      ...campaignAtts.map((a) => `- [campanha] ${a.kind}: ${a.filename}${a.caption ? ` — ${a.caption}` : ""} (${a.url})`)
    ];
    blocks.push(`[MATERIAIS DISPONÍVEIS]\n${lines.join("\n")}`);
  }

  if (summary) blocks.push(`[RESUMO DA CONVERSA ANTERIOR]\n${summary}`);

  const systemPrompt = blocks.join("\n\n");

  let firstTouchUser: ChatMessage | undefined;
  if (firstTouch && history.length === 0) {
    const lead = conv.lead;
    firstTouchUser = {
      role: "user",
      content: `[NOVO LEAD] Nome: ${lead.name ?? "não informado"} | Telefone: ${lead.phone}${lead.propertyRef ? ` | Imóvel: ${lead.propertyRef}` : ""}${lead.origin ? ` | Origem: ${lead.origin}` : ""}`
    };
  }

  return { conv, systemPrompt, history, firstTouchUser };
}
