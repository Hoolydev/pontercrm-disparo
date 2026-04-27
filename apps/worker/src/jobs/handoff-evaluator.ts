import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getLLMForModel } from "@pointer/llm";
import type { HandoffEvaluatorJob } from "@pointer/queue";
import { getQueues } from "@pointer/queue";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

const CH = { inbox: "inbox:updates" };
const CLASSIFIER_MODEL = process.env.CLASSIFIER_MODEL ?? "gpt-4o-mini";

export async function processHandoffEvaluator(
  job: HandoffEvaluatorJob,
  db: Database,
  publisher: Redis,
  logger: Logger
) {
  const { conversationId, toolCalls = [] } = job;

  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversationId),
    with: { agent: true, assignedBroker: true }
  });
  if (!conv || conv.aiPaused) return;

  // ── 1. Tool-call trigger (highest priority) ───────────────────────────────
  // Accepts both legacy `handoff_to_broker` and new `transfer_to_broker` tool names.
  const handoffTool = toolCalls.find(
    (tc) => tc.name === "handoff_to_broker" || tc.name === "transfer_to_broker"
  );
  if (handoffTool) {
    await doHandoff(
      db,
      publisher,
      conversationId,
      conv.assignedBrokerId,
      String(handoffTool.arguments.reason ?? "tool_call"),
      logger
    );
    return;
  }

  // ── 2. Load active triggers ───────────────────────────────────────────────
  const triggers = conv.agentId
    ? await db.query.handoffTriggers.findMany({
        where: and(
          eq(schema.handoffTriggers.active, true),
          eq(schema.handoffTriggers.agentId, conv.agentId)
        ),
        orderBy: [desc(schema.handoffTriggers.priority)]
      })
    : [];

  // Also load global triggers (agent_id IS NULL)
  const globalTriggers = await db.query.handoffTriggers.findMany({
    where: and(
      eq(schema.handoffTriggers.active, true),
      isNull(schema.handoffTriggers.agentId)
    ),
    orderBy: [desc(schema.handoffTriggers.priority)]
  });

  const allTriggers = [...globalTriggers, ...triggers].sort(
    (a, b) => a.priority - b.priority
  );
  if (!allTriggers.length) return;

  // Last lead message
  const lastLeadMsg = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.conversationId, conversationId),
      eq(schema.messages.direction, "in")
    ),
    orderBy: [desc(schema.messages.createdAt)]
  });
  const leadText = lastLeadMsg?.content ?? "";

  for (const trigger of allTriggers) {
    let matched = false;

    if (trigger.patternType === "keyword") {
      matched = leadText.toLowerCase().includes(trigger.pattern.toLowerCase());
    } else if (trigger.patternType === "regex") {
      try {
        matched = new RegExp(trigger.pattern, "i").test(leadText);
      } catch {}
    } else if (trigger.patternType === "llm_classifier") {
      try {
        const llm = await getLLMForModel(CLASSIFIER_MODEL);
        const label = await llm.classify({
          model: CLASSIFIER_MODEL,
          system: trigger.pattern, // pattern is the classification instruction
          input: leadText,
          labels: ["sim", "não"]
        });
        matched = label === "sim";
      } catch (err) {
        logger.error({ err, triggerId: trigger.id }, "classifier error");
      }
    }

    if (matched) {
      logger.info({ conversationId, triggerId: trigger.id, type: trigger.patternType }, "handoff triggered");
      await doHandoff(
        db,
        publisher,
        conversationId,
        conv.assignedBrokerId,
        `trigger:${trigger.name}`,
        logger
      );
      return;
    }
  }
}

async function doHandoff(
  db: Database,
  publisher: Redis,
  conversationId: string,
  brokerId: string | null,
  reason: string,
  logger: Logger
) {
  await db
    .update(schema.conversations)
    .set({ aiPaused: true, status: "handed_off", handoffReason: reason })
    .where(eq(schema.conversations.id, conversationId));

  await getQueues().brokerNotify.add(`handoff:${conversationId}`, {
    brokerId: brokerId ?? "unassigned",
    conversationId,
    kind: "handoff",
    message: reason
  });

  await publisher.publish(
    CH.inbox,
    JSON.stringify({
      kind: "handoff",
      conversationId,
      brokerId,
      reason
    })
  );

  logger.info({ conversationId, brokerId, reason }, "handoff: done");
}
