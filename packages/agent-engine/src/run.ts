import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getLLMForModel } from "@pointer/llm";
import type { ChatMessage, ToolDef } from "@pointer/llm";
import { getQueues, withLock } from "@pointer/queue";
import type { MediaType } from "@pointer/shared";
import { newId, sha256 } from "@pointer/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { loadContext } from "./context.js";
import { builtInTools, resolveToolName } from "./tools/index.js";
import type {
  AgentEngineDeps,
  EngineLogger,
  RunAgentInput,
  RunAgentResult,
  ToolEntry,
  ToolExecutionRecord,
  ToolRegistry
} from "./types.js";

const CH_INBOX = "inbox:updates";
// 60s gives slow tool handlers (DB writes + provider calls) headroom; the
// LLM call itself runs OUTSIDE the lock, so most lock holders are short.
// If a holder dies mid-flight, lock auto-expires and another job retries.
const LOCK_TTL_MS = 60_000;

/**
 * Default delay range used when an agent doesn't specify behavior.delay_range_ms.
 * Keep in sync with seed.ts defaults to avoid surprising users.
 */
const DEFAULT_DELAY_RANGE: [number, number] = [8_000, 15_000];

/**
 * Resolve which tools the LLM should see for a given agent:
 *   intersection(agent.behavior.tools_enabled, registry).
 * If `tools_enabled` is missing, fall back to the full registry (legacy behavior).
 */
function resolveAgentTools(
  registry: ToolRegistry,
  toolsEnabled: string[] | undefined
): ToolEntry[] {
  if (!toolsEnabled || toolsEnabled.length === 0) {
    // Legacy default: expose every registered tool.
    return Object.values(registry);
  }
  const out: ToolEntry[] = [];
  for (const name of toolsEnabled) {
    const entry = registry[name];
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Resolve typing-delay range. Campaign settings win over agent behavior so a
 * single agent reused across campaigns can have different delays per campaign.
 */
function pickDelay(opts: {
  campaignDelayRange?: [number, number];
  agentDelayRange?: [number, number];
}): number {
  const range = opts.campaignDelayRange ?? opts.agentDelayRange ?? DEFAULT_DELAY_RANGE;
  const [lo, hi] = range;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** Substitute `{{var}}` placeholders in a template string. Unknown vars stay literal. */
/**
 * Substitute placeholders in a template string. Permissive on syntax — accepts
 * both `{{name}}` and `{name}` — and accepts PT-BR aliases. Unknown vars stay
 * literal so a typo doesn't silently turn into "" in the lead's WhatsApp.
 */
const VAR_ALIASES: Record<string, string> = {
  // EN → canonical
  name: "name",
  phone: "phone",
  property_ref: "property_ref",
  origin: "origin",
  campaign: "campaign",
  // PT-BR → canonical
  nome: "name",
  telefone: "phone",
  celular: "phone",
  whatsapp: "phone",
  imovel: "property_ref",
  imovel_ref: "property_ref",
  codigo: "property_ref",
  origem: "origin",
  campanha: "campaign"
};

function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>
): string {
  // Match double-brace first (more specific), then single-brace.
  // Behavior:
  //   - Recognized var with value → replace
  //   - Recognized var with null/empty value → replace with "" (don't leak
  //     "{nome}" into the lead's WhatsApp when lead.name is null)
  //   - Unrecognized name (typo, unknown var) → keep literal so the human
  //     reviewing the template sees the broken placeholder instead of an
  //     empty hole.
  const sub = (m: string, key: string) => {
    const canonical = VAR_ALIASES[String(key).toLowerCase()];
    if (!canonical) return m; // typo — keep literal
    const v = vars[canonical];
    return v == null ? "" : String(v);
  };
  return template
    .replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, sub)
    .replace(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g, sub);
}

export async function runAgent(
  deps: AgentEngineDeps,
  input: RunAgentInput
): Promise<RunAgentResult> {
  const { db, publisher, logger } = deps;
  const registry: ToolRegistry = deps.tools ?? builtInTools;
  const { conversationId, mode, firstTouch, trigger } = input;

  // ── 1. Load context (agent, lead, campaign, history, memory) ──────────
  let ctx = await loadContext({ db, conversationId, mode, firstTouch });
  if (!ctx) {
    logger.warn({ conversationId }, "engine: conversation or agent missing — skip");
    return {
      status: "skipped",
      toolCallsExecuted: [],
      outboundEnqueued: false,
      reason: "no_context"
    };
  }

  if (ctx.conv.aiPaused) {
    logger.info({ conversationId }, "engine: ai_paused — skip");
    return {
      status: "skipped",
      toolCallsExecuted: [],
      outboundEnqueued: false,
      reason: "ai_paused"
    };
  }

  // ── 1.1. Outbound → Inbound handoff swap ───────────────────────────────
  // The outbound agent's job ends after the first touch. When the lead
  // replies (mode='inbound'), we permanently swap the conversation to the
  // outbound's configured handoff inbound so qualification / tools / system
  // prompt all come from the inbound.
  //
  // Done under the conv lock so two concurrent inbound jobs can't both swap
  // and run independent LLM turns in parallel. The UPDATE has a guard
  // (WHERE agentId = old outbound id) so a second job that wakes after the
  // first one already swapped will affect 0 rows and skip the reload.
  if (
    ctx.conv.agent &&
    ctx.conv.agent.type === "outbound" &&
    mode === "inbound" &&
    ctx.conv.agent.handoffAgentId
  ) {
    const oldAgentId = ctx.conv.agentId!;
    const newAgentId = ctx.conv.agent.handoffAgentId;

    let didSwap = false;
    await withLock(`conv:${conversationId}`, LOCK_TTL_MS, async () => {
      const upd = await db
        .update(schema.conversations)
        .set({ agentId: newAgentId })
        .where(
          and(
            eq(schema.conversations.id, conversationId),
            eq(schema.conversations.agentId, oldAgentId)
          )
        )
        .returning({ id: schema.conversations.id });
      didSwap = upd.length > 0;
    });

    logger.info(
      { conversationId, fromAgent: oldAgentId, toAgent: newAgentId, didSwap },
      "engine: outbound→inbound handoff"
    );

    const reloaded = await loadContext({ db, conversationId, mode, firstTouch });
    if (!reloaded) {
      logger.warn({ conversationId }, "engine: handoff reload failed — skip");
      return {
        status: "skipped",
        toolCallsExecuted: [],
        outboundEnqueued: false,
        reason: "handoff_reload_failed"
      };
    }
    ctx = reloaded;
  }

  const { conv } = ctx;
  const agent = conv.agent!;
  const behavior = agent.behaviorJson ?? {};
  const campaignSettings = conv.campaign?.settingsJson ?? {};
  const campaignDelay = campaignSettings.delay_range_ms;

  // ── 1.5. Outbound first-message template fast path ───────────────────
  // If we have a first-message template for this outbound first turn
  // (mode='outbound', firstTouch, no prior messages), skip the LLM and send
  // the rendered template verbatim. Agent-level template wins over
  // campaign-level (so a single campaign can use different opening lines
  // per agent).
  const firstMessageTpl =
    (agent.firstMessage && agent.firstMessage.trim()) ||
    conv.campaign?.firstMessageTemplate ||
    null;
  if (
    mode === "outbound" &&
    firstTouch &&
    ctx.history.length === 0 &&
    firstMessageTpl
  ) {
    const text = renderTemplate(firstMessageTpl, {
      name: conv.lead.name,
      phone: conv.lead.phone,
      property_ref: conv.lead.propertyRef,
      origin: conv.lead.origin,
      campaign: conv.campaign?.name ?? null
    });

    let aiMsgIdTpl: string | null = null;
    const textDelay = pickDelay({
      campaignDelayRange: campaignDelay,
      agentDelayRange: behavior.delay_range_ms
    });
    await withLock(`conv:${conversationId}`, LOCK_TTL_MS, async () => {
      const contentHash = sha256(`tpl:${conversationId}:${text}`);
      aiMsgIdTpl = newId();
      await db.insert(schema.messages).values({
        id: aiMsgIdTpl,
        conversationId,
        direction: "out",
        senderType: "ai",
        content: text,
        contentHash,
        status: "queued"
      });
      await db
        .update(schema.conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.conversations.id, conversationId));

      const queues = getQueues();
      await queues.outboundMessage.add(
        `tpl-${aiMsgIdTpl}`,
        { messageId: aiMsgIdTpl, conversationId },
        { delay: textDelay }
      );
      await publisher.publish(
        CH_INBOX,
        JSON.stringify({
          kind: "message:new",
          conversationId,
          messageId: aiMsgIdTpl,
          senderType: "ai",
          brokerId: conv.assignedBrokerId
        })
      );
    });

    let attachmentsSent = 0;
    if (conv.campaignId) {
      const atts = await db.query.campaignAttachments.findMany({
        where: eq(schema.campaignAttachments.campaignId, conv.campaignId),
        orderBy: [asc(schema.campaignAttachments.createdAt)]
      });

      const queues = getQueues();
      let i = 0;
      for (const att of atts) {
        const mediaMsgId = newId();
        const contentHash = sha256(`camp-att:${conversationId}:${att.id}`);
        await db.insert(schema.messages).values({
          id: mediaMsgId,
          conversationId,
          direction: "out",
          senderType: "ai",
          content: att.caption ?? "",
          contentHash,
          mediaUrl: att.url,
          mediaType: att.kind as MediaType,
          status: "queued"
        });
        await queues.outboundMessage.add(
          `camp-att-${mediaMsgId}`,
          { messageId: mediaMsgId, conversationId },
          { delay: textDelay + (i + 1) * 3000, jobId: `camp-att-${mediaMsgId}` }
        );
        await publisher.publish(
          CH_INBOX,
          JSON.stringify({
            kind: "message:new",
            conversationId,
            messageId: mediaMsgId,
            senderType: "ai",
            brokerId: conv.assignedBrokerId
          })
        );
        attachmentsSent++;
        i++;
      }
    }

    logger.info(
      { conversationId, mode, templated: true, attachmentsSent },
      "engine: first-message template dispatched (skipped LLM)"
    );

    return {
      status: "replied",
      messageId: aiMsgIdTpl ?? undefined,
      toolCallsExecuted: [],
      outboundEnqueued: true
    };
  }

  const chatMessages: ChatMessage[] = [...ctx.history];
  if (ctx.firstTouchUser) chatMessages.push(ctx.firstTouchUser);

  if (chatMessages.length === 0) {
    logger.info({ conversationId }, "engine: nothing to respond");
    return {
      status: "skipped",
      toolCallsExecuted: [],
      outboundEnqueued: false,
      reason: "empty_history"
    };
  }

  // ── 2. Build tool defs ─────────────────────────────────────────────────
  const enabledTools = resolveAgentTools(registry, behavior.tools_enabled);
  const toolDefs: ToolDef[] = enabledTools.map((t) => t.definition);

  // ── 3. LLM call (no lock held) ─────────────────────────────────────────
  const llm = await getLLMForModel(agent.model);
  logger.info(
    { conversationId, mode, model: agent.model, trigger: trigger.kind, tools: toolDefs.length },
    "engine: calling LLM"
  );

  const response = await llm.chat({
    model: agent.model,
    system: ctx.systemPrompt,
    messages: chatMessages,
    tools: toolDefs.length ? toolDefs : undefined,
    temperature: behavior.temperature ?? 0.7,
    maxTokens: behavior.max_tokens ?? 1024
  });

  if (!response.content && response.toolCalls.length === 0) {
    logger.warn({ conversationId }, "engine: empty LLM response");
    return {
      status: "skipped",
      toolCallsExecuted: [],
      outboundEnqueued: false,
      reason: "empty_response"
    };
  }

  // Normalize tool names (handoff_to_broker → transfer_to_broker)
  const normalizedToolCalls = response.toolCalls.map((tc) => ({
    ...tc,
    name: resolveToolName(tc.name)
  }));

  // ── 4. Persist + dispatch (under lock) ─────────────────────────────────
  let aiMsgId: string | null = null;
  let pausedByTool = false;
  const toolExecutions: ToolExecutionRecord[] = [];

  await withLock(`conv:${conversationId}`, LOCK_TTL_MS, async () => {
    // 4a. Persist AI message (if any text content or tool calls)
    if (response.content || normalizedToolCalls.length > 0) {
      const contentHash = sha256(`ai:${conversationId}:${response.content || JSON.stringify(normalizedToolCalls)}`);
      aiMsgId = newId();
      await db.insert(schema.messages).values({
        id: aiMsgId,
        conversationId,
        direction: "out",
        senderType: "ai",
        content: response.content || "",
        contentHash,
        status: "queued",
        toolCalls: normalizedToolCalls.length
          ? normalizedToolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments }))
          : null
      });
      await db
        .update(schema.conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.conversations.id, conversationId));
    }

    // 4b. Execute tool calls (idempotent via tool_executions UNIQUE)
    if (normalizedToolCalls.length && aiMsgId) {
      pausedByTool = await runToolCalls({
        db,
        publisher,
        logger,
        registry,
        enabledNames: new Set(enabledTools.map((t) => t.definition.name)),
        conversationId,
        messageId: aiMsgId,
        agentId: conv.agentId,
        campaignId: conv.campaignId,
        toolCalls: normalizedToolCalls,
        out: toolExecutions
      });
    }

    const queues = getQueues();

    // 4c. Always enqueue handoff-evaluator for non-tool triggers (keyword/regex/llm)
    await queues.handoffEvaluator.add(`eval:${conversationId}:${Date.now()}`, {
      conversationId,
      lastAiMessageId: aiMsgId ?? undefined,
      toolCalls: normalizedToolCalls
    });

    // 4d. Enqueue outbound dispatch unless tool paused us or there is no text
    if (!pausedByTool && aiMsgId) {
      const delay = pickDelay({
        campaignDelayRange: campaignDelay,
        agentDelayRange: behavior.delay_range_ms
      });
      await queues.outboundMessage.add(
        `ai-send-${aiMsgId}`,
        { messageId: aiMsgId, conversationId },
        { delay, jobId: `ai-send-${aiMsgId}` }
      );
    }

    // 4e. Memory summarize threshold
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId));
    const summarizeAfter = behavior.summarize_after_messages ?? 40;
    if ((row?.n ?? 0) > summarizeAfter) {
      await queues.memorySummarize
        .add(
          "summarize",
          { conversationId },
          { jobId: `summarize:${conversationId}` }
        )
        .catch((err) =>
          logger.error(
            { err, conversationId },
            "engine: failed to enqueue memorySummarize"
          )
        );
    }

    // 4f. SSE
    if (aiMsgId) {
      await publisher.publish(
        CH_INBOX,
        JSON.stringify({
          kind: "message:new",
          conversationId,
          messageId: aiMsgId,
          senderType: "ai",
          brokerId: conv.assignedBrokerId
        })
      );
    }
  });

  const outboundEnqueued = !pausedByTool && aiMsgId !== null;

  logger.info(
    { conversationId, mode, tools: toolExecutions.length, pausedByTool },
    "engine: turn complete"
  );

  return {
    status: pausedByTool
      ? "paused_by_handoff"
      : aiMsgId
        ? "replied"
        : toolExecutions.length
          ? "tool_only"
          : "skipped",
    messageId: aiMsgId ?? undefined,
    toolCallsExecuted: toolExecutions,
    outboundEnqueued
  };
}

// ─── Tool execution helper ────────────────────────────────────────────────

async function runToolCalls(opts: {
  db: Database;
  publisher: Redis;
  logger: EngineLogger;
  registry: ToolRegistry;
  enabledNames: Set<string>;
  conversationId: string;
  messageId: string;
  agentId: string | null;
  campaignId: string | null;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  out: ToolExecutionRecord[];
}): Promise<boolean> {
  const {
    db,
    publisher,
    logger,
    registry,
    enabledNames,
    conversationId,
    messageId,
    agentId,
    campaignId,
    toolCalls,
    out
  } = opts;

  let pausedAi = false;

  for (const tc of toolCalls) {
    const entry = registry[tc.name];
    if (!entry) {
      logger.warn({ conversationId, toolName: tc.name }, "engine: unknown tool — skip");
      out.push({ toolName: tc.name, status: "error", error: "unknown_tool" });
      continue;
    }

    if (!enabledNames.has(tc.name)) {
      logger.warn(
        { conversationId, toolName: tc.name },
        "engine: tool not enabled for this agent — skip"
      );
      out.push({ toolName: tc.name, status: "error", error: "tool_not_enabled" });
      continue;
    }

    // Idempotency: try to claim execution row first.
    const claimId = newId();
    try {
      await db.insert(schema.toolExecutions).values({
        id: claimId,
        conversationId,
        messageId,
        toolName: tc.name,
        argumentsJson: tc.arguments,
        status: "ok" // tentative; updated after handler
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("tool_executions_message_tool_uq")) {
        logger.info(
          { conversationId, messageId, toolName: tc.name },
          "engine: tool_call duplicate — already executed"
        );
        out.push({ toolName: tc.name, status: "duplicate" });
        continue;
      }
      logger.error({ err, conversationId, toolName: tc.name }, "engine: tool_executions insert failed");
      out.push({ toolName: tc.name, status: "error", error: msg });
      continue;
    }

    // Execute handler
    try {
      const outcome = await entry.handler({
        conversationId,
        messageId,
        agentId,
        campaignId,
        args: tc.arguments,
        db,
        publisher,
        logger
      });

      await db
        .update(schema.toolExecutions)
        .set({
          status: outcome.status,
          resultJson: outcome.result ?? null,
          error: outcome.error ?? null
        })
        .where(eq(schema.toolExecutions.id, claimId));

      if (outcome.pausesAi) pausedAi = true;
      out.push({
        toolName: tc.name,
        status: outcome.status,
        result: outcome.result,
        error: outcome.error
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, conversationId, toolName: tc.name }, "engine: tool handler threw");
      await db
        .update(schema.toolExecutions)
        .set({ status: "error", error: msg })
        .where(eq(schema.toolExecutions.id, claimId))
        .catch((updErr) =>
          logger.error(
            { err: updErr, conversationId, toolName: tc.name, claimId },
            "engine: failed to mark tool_execution as error"
          )
        );
      out.push({ toolName: tc.name, status: "error", error: msg });
    }
  }

  return pausedAi;
}
