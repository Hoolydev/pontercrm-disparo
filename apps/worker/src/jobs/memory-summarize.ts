import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getLLMForModel } from "@pointer/llm";
import type { MemorySummarizeJob } from "@pointer/queue";
import { asc, eq, sql } from "drizzle-orm";
import type { Logger } from "pino";

const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "gpt-4o-mini";
const KEEP_RECENT = 20; // keep last N messages unsummarized

export async function processMemorySummarize(
  job: MemorySummarizeJob,
  db: Database,
  logger: Logger
) {
  const { conversationId } = job;

  const allMsgs = await db.query.messages.findMany({
    where: eq(schema.messages.conversationId, conversationId),
    orderBy: [asc(schema.messages.createdAt)]
  });

  if (allMsgs.length <= KEEP_RECENT) {
    logger.info({ conversationId }, "summarize: not enough messages yet");
    return;
  }

  const toSummarize = allMsgs.slice(0, allMsgs.length - KEEP_RECENT);
  const existing = await db.query.conversationMemory.findFirst({
    where: eq(schema.conversationMemory.conversationId, conversationId)
  });

  const priorSummary = existing?.summary ?? "";
  const transcript = toSummarize
    .map((m) => `${m.senderType === "lead" ? "Lead" : "Atendente"}: ${m.content}`)
    .join("\n");

  const llm = await getLLMForModel(SUMMARY_MODEL);
  const res = await llm.chat({
    model: SUMMARY_MODEL,
    system:
      "Você é um assistente que resume conversas de atendimento imobiliário de forma concisa. " +
      "Capture: interesse do lead, imóveis mencionados, objeções, etapa do funil, compromisos feitos.",
    messages: [
      {
        role: "user",
        content:
          (priorSummary ? `[RESUMO ANTERIOR]\n${priorSummary}\n\n` : "") +
          `[TRECHO A RESUMIR]\n${transcript}`
      }
    ],
    temperature: 0.3,
    maxTokens: 512
  });

  const newSummary = res.content.trim();
  const tokensUsed = (res.usage?.inputTokens ?? 0) + (res.usage?.outputTokens ?? 0);

  if (existing) {
    await db
      .update(schema.conversationMemory)
      .set({ summary: newSummary, lastSummarizedAt: new Date(), tokensUsed })
      .where(eq(schema.conversationMemory.conversationId, conversationId));
  } else {
    await db.insert(schema.conversationMemory).values({
      conversationId,
      summary: newSummary,
      lastSummarizedAt: new Date(),
      tokensUsed
    });
  }

  logger.info({ conversationId, chars: newSummary.length }, "summarize: done");
}
