import { applyMessageSignals } from "@pointer/agent-engine";
import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getQueues, withLock } from "@pointer/queue";
import type { InboundMessageJob } from "@pointer/queue";
import { newId, normalizeE164, sha256 } from "@pointer/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

// Auto-creates a lead + conversation for unknown inbound numbers (API oficial / Meta).
async function findOrCreateConversation(
  db: Database,
  instanceId: string,
  fromPhone: string,
  logger: Logger
) {
  // Normalize to E.164 so it matches regardless of how the provider formats it.
  const phone = normalizeE164(fromPhone);

  // Try lead by phone first (any source).
  let lead = await db.query.leads.findFirst({
    where: eq(schema.leads.phone, phone)
  });

  // Resolve an active conversation for this lead + instance.
  let conv = lead
    ? await db.query.conversations.findFirst({
        where: sql`
          ${schema.conversations.whatsappInstanceId} = ${instanceId}
          AND ${schema.conversations.leadId} = ${lead.id}
        `,
        with: { lead: true }
      })
    : null;

  if (conv) return conv;

  // --- Auto-creation path ---
  logger.info({ instanceId, phone }, "inbound: unknown number — auto-creating lead + conversation");

  // Fetch required references in parallel.
  const [brokerRow, inboundAgent, defaultStage, directSource] = await Promise.all([
    db.query.brokers.findFirst({ columns: { id: true } }),
    db.query.agents.findFirst({
      where: and(eq(schema.agents.active, true), eq(schema.agents.type, "inbound"))
    }),
    db.query.pipelineStages.findFirst({ columns: { id: true } }),
    // Find or create the sentinel lead source used for direct WhatsApp inbounds.
    db.query.leadSources.findFirst({
      where: eq(schema.leadSources.name, "WhatsApp Direto")
    })
  ]);

  // Upsert sentinel lead source (runs at most once per deployment).
  let sourceId = directSource?.id;
  if (!sourceId) {
    const sid = newId();
    await db
      .insert(schema.leadSources)
      .values({
        id: sid,
        type: "whatsapp_direct",
        name: "WhatsApp Direto",
        webhookSecret: newId(), // unused but NOT NULL
        active: true
      })
      .onConflictDoNothing();
    sourceId =
      (await db.query.leadSources.findFirst({
        where: eq(schema.leadSources.name, "WhatsApp Direto"),
        columns: { id: true }
      }))?.id ?? sid;
  }

  if (!lead) {
    if (!defaultStage) {
      logger.error({ phone }, "inbound: no pipeline stage found — cannot create lead");
      return null;
    }
    const [newLead] = await db
      .insert(schema.leads)
      .values({
        phone,
        name: null,
        email: null,
        sourceId,
        origin: "whatsapp_inbound",
        pipelineStageId: defaultStage.id,
        assignedBrokerId: brokerRow?.id ?? undefined
      })
      .returning();
    lead = newLead!;
  }

  const convId = newId();
  await db.insert(schema.conversations).values({
    id: convId,
    leadId: lead.id,
    status: "ai_active",
    mode: "inbound",
    whatsappInstanceId: instanceId,
    agentId: inboundAgent?.id ?? undefined,
    assignedBrokerId: lead.assignedBrokerId ?? brokerRow?.id ?? undefined,
    aiPaused: false,
    lastMessageAt: new Date()
  });

  return db.query.conversations.findFirst({
    where: eq(schema.conversations.id, convId),
    with: { lead: true }
  });
}

// CH import matches apps/api — keep in sync or extract to @pointer/queue
const CH = { inbox: "inbox:updates" };

export async function processInboundMessage(
  job: InboundMessageJob,
  db: Database,
  publisher: Redis,
  logger: Logger
) {
  const { instanceId, fromPhone, content, mediaUrl, providerMessageId } = job;

  // Find existing conversation or auto-create lead + conversation for new numbers.
  const conv = await findOrCreateConversation(db, instanceId, fromPhone, logger);

  if (!conv) {
    logger.error({ instanceId, fromPhone }, "inbound: failed to create conversation — skipping");
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
