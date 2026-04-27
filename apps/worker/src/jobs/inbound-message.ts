import { applyMessageSignals } from "@pointer/agent-engine";
import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getQueues, withLock } from "@pointer/queue";
import type { InboundMessageJob } from "@pointer/queue";
import { newId, sha256 } from "@pointer/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

// CH import matches apps/api — keep in sync or extract to @pointer/queue
const CH = { inbox: "inbox:updates" };

export async function processInboundMessage(
  job: InboundMessageJob,
  db: Database,
  publisher: Redis,
  logger: Logger
) {
  const { instanceId, fromPhone, content, mediaUrl, providerMessageId } = job;

  // Find conversation by instance + lead phone
  const conv = await db.query.conversations.findFirst({
    where: sql`
      ${schema.conversations.whatsappInstanceId} = ${instanceId}
      AND ${schema.conversations.leadId} IN (
        SELECT id FROM leads WHERE phone = ${fromPhone} LIMIT 1
      )
    `,
    with: { lead: true }
  });

  if (!conv) {
    logger.warn({ instanceId, fromPhone }, "inbound: no conversation found — skipping");
    return;
  }

  const contentHash = sha256(`${conv.id}:${content}`);

  await withLock(`conv:${conv.id}`, 60_000, async () => {
    // Dedup #1: provider-supplied message id is the authoritative key. If we
    // already persisted a message with this provider_message_id (regardless of
    // age), the webhook re-fired and we skip. This is the strongest dedup.
    if (providerMessageId) {
      const sameProviderMsg = await db.query.messages.findFirst({
        where: and(
          eq(schema.messages.conversationId, conv.id),
          eq(schema.messages.providerMessageId, providerMessageId)
        )
      });
      if (sameProviderMsg) {
        logger.info(
          { conversationId: conv.id, providerMessageId },
          "inbound: duplicate (providerMessageId) skipped"
        );
        return;
      }
    }

    // Dedup #2: same content hash within 5 minutes. Catches cases where the
    // provider doesn't supply a stable message id, or replays with a fresh id.
    const recent = await db.query.messages.findFirst({
      where: and(
        eq(schema.messages.conversationId, conv.id),
        eq(schema.messages.contentHash, contentHash),
        sql`${schema.messages.createdAt} > now() - interval '5 minutes'`
      )
    });
    if (recent) {
      logger.info({ conversationId: conv.id, contentHash }, "inbound: duplicate (hash) skipped");
      return;
    }

    const msgId = newId();
    await db.insert(schema.messages).values({
      id: msgId,
      conversationId: conv.id,
      direction: "in",
      senderType: "lead",
      instanceId,
      content,
      mediaUrl,
      contentHash,
      providerMessageId,
      status: "delivered"
    });

    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(schema.conversations.id, conv.id));

    // Publish SSE event (scoped to assigned broker)
    const event = JSON.stringify({
      kind: "message:new",
      conversationId: conv.id,
      messageId: msgId,
      senderType: "lead",
      brokerId: conv.assignedBrokerId
    });
    await publisher.publish(CH.inbox, event);

    logger.info({ conversationId: conv.id, msgId }, "inbound: message persisted");

    // Mark campaign_leads.replied (idempotent: only if not already 'replied')
    if (conv.campaignId) {
      await db
        .update(schema.campaignLeads)
        .set({ state: "replied" })
        .where(
          and(
            eq(schema.campaignLeads.campaignId, conv.campaignId),
            eq(schema.campaignLeads.leadId, conv.leadId),
            ne(schema.campaignLeads.state, "replied")
          )
        );
    }

    // Apply scoring signals (deterministic regex-based detector).
    // Done outside the lock would be safer, but it's a single insert + upsert
    // — keep it inline so it shows up in the same audit window.
    try {
      const signals = await applyMessageSignals(db, conv.leadId, content, {
        messageId: msgId,
        conversationId: conv.id
      });
      if (signals.length > 0) {
        logger.info({ conversationId: conv.id, signals }, "scoring: signals applied");
      }
    } catch (err) {
      logger.error({ err, conversationId: conv.id }, "scoring: failed");
    }

    // Hand off to the AI engine for the next turn (mode=inbound) unless paused.
    if (!conv.aiPaused) {
      await getQueues().aiReply.add(`reply-${conv.id}-${msgId}`, {
        conversationId: conv.id,
        mode: "inbound",
        trigger: { kind: "webhook_inbound", refId: providerMessageId }
      }, { jobId: `reply-${conv.id}-${msgId}` });
    }
  });
}
