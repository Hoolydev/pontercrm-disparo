import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { getProvider } from "@pointer/providers";
import { getRedis } from "@pointer/queue";
import type { OutboundMessageJob } from "@pointer/queue";
import { decryptJson, newId } from "@pointer/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

const CH = { inbox: "inbox:updates" };
const DEFAULT_CAMPAIGN_MPM = 20;

/**
 * Per-campaign rate-limit gate. Returns `null` when allowed (counter incremented),
 * or a number of ms to wait when the campaign window is full.
 *
 * Window granularity = current minute (epoch_minute). Counter expires in 60s,
 * so DECR-on-overflow doesn't strictly need to undo — but we DECR anyway to be
 * a fair citizen across replicas.
 */
async function reserveCampaignSlot(
  redis: Redis,
  campaignId: string,
  maxPerMinute: number
): Promise<number | null> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `campaign:${campaignId}:minute:${minute}`;
  const next = await redis.incr(key);
  if (next === 1) await redis.expire(key, 60);
  if (next > maxPerMinute) {
    await redis.decr(key);
    // Wait until the start of the next minute.
    return 60_000 - (Date.now() % 60_000);
  }
  return null;
}

export async function processOutboundMessage(
  job: OutboundMessageJob,
  db: Database,
  publisher: Redis,
  logger: Logger
): Promise<void> {
  const { messageId, conversationId } = job;

  const msg = await db.query.messages.findFirst({
    where: eq(schema.messages.id, messageId)
  });
  if (!msg) {
    logger.warn({ messageId }, "outbound: message not found");
    return;
  }
  if (msg.status === "sent") {
    logger.info({ messageId }, "outbound: already sent, skip");
    return;
  }

  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversationId),
    with: { lead: true, campaign: true }
  });
  if (!conv?.lead) throw new Error(`conversation ${conversationId} not found`);

  // ─── Per-campaign rate limit ────────────────────────────────────────
  if (conv.campaignId && conv.campaign) {
    const mpm = conv.campaign.settingsJson?.max_messages_per_minute ?? DEFAULT_CAMPAIGN_MPM;
    const waitMs = await reserveCampaignSlot(getRedis(), conv.campaignId, mpm);
    if (waitMs !== null) {
      logger.info(
        { messageId, campaignId: conv.campaignId, waitMs },
        "outbound: campaign rate limit hit — re-throw for retry"
      );
      // Throwing makes BullMQ retry; backoff defaults will handle the delay.
      throw new Error("campaign_rate_limit");
    }
  }

  // Dedup: same hash sent to same conversation in last 5min?
  const dup = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.conversationId, conversationId),
      eq(schema.messages.contentHash, msg.contentHash),
      eq(schema.messages.direction, "out"),
      sql`${schema.messages.id} != ${messageId}`,
      sql`${schema.messages.createdAt} > now() - interval '5 minutes'`
    )
  });
  if (dup) {
    logger.info({ messageId, dupId: dup.id }, "outbound: duplicate content suppressed");
    await db
      .update(schema.messages)
      .set({ status: "failed" })
      .where(eq(schema.messages.id, messageId));
    return;
  }

  // ── Select instance ────────────────────────────────────────────────
  // Sticky behavior: a conversation should consistently send from the same
  // WhatsApp number (the one fixed at conversation creation in outbound-blast).
  // Switching numbers mid-conversation triggers WhatsApp anti-spam → ban risk.
  //
  // Strategy:
  //   1) If conv.whatsappInstanceId is set AND that instance is connected/active
  //      AND under its rate limit → use it (FOR UPDATE SKIP LOCKED).
  //   2) Otherwise (instance disconnected or rate-limited): fall back to LRU
  //      across the campaign's pool (when in a campaign) or globally.
  let instance: typeof schema.whatsappInstances.$inferSelect | undefined;

  if (conv.whatsappInstanceId) {
    const [stickyRow] = await db
      .select()
      .from(schema.whatsappInstances)
      .where(
        and(
          eq(schema.whatsappInstances.id, conv.whatsappInstanceId),
          eq(schema.whatsappInstances.active, true),
          eq(schema.whatsappInstances.status, "connected"),
          sql`${schema.whatsappInstances.messagesSentLastMinute} < ${schema.whatsappInstances.rateLimitPerMinute}`
        )
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (stickyRow) instance = stickyRow;
  }

  if (!instance) {
    // Fall back to LRU. Scope to campaign pool when applicable so we don't
    // accidentally send from a number that's not whitelisted for this campaign.
    if (conv.campaignId) {
      const [campRow] = await db
        .select({
          // need full instance columns since we use them later
          id: schema.whatsappInstances.id,
          provider: schema.whatsappInstances.provider,
          externalId: schema.whatsappInstances.externalId,
          number: schema.whatsappInstances.number,
          status: schema.whatsappInstances.status,
          rateLimitPerMinute: schema.whatsappInstances.rateLimitPerMinute,
          messagesSentLastMinute: schema.whatsappInstances.messagesSentLastMinute,
          lastUsedAt: schema.whatsappInstances.lastUsedAt,
          configJson: schema.whatsappInstances.configJson,
          active: schema.whatsappInstances.active,
          createdAt: schema.whatsappInstances.createdAt,
          updatedAt: schema.whatsappInstances.updatedAt
        })
        .from(schema.whatsappInstances)
        .innerJoin(
          schema.campaignInstances,
          eq(schema.campaignInstances.instanceId, schema.whatsappInstances.id)
        )
        .where(
          and(
            eq(schema.campaignInstances.campaignId, conv.campaignId),
            eq(schema.whatsappInstances.active, true),
            eq(schema.whatsappInstances.status, "connected"),
            sql`${schema.whatsappInstances.messagesSentLastMinute} < ${schema.whatsappInstances.rateLimitPerMinute}`
          )
        )
        .orderBy(asc(schema.whatsappInstances.lastUsedAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (campRow) instance = campRow as typeof schema.whatsappInstances.$inferSelect;
    }

    if (!instance) {
      const [globalRow] = await db
        .select()
        .from(schema.whatsappInstances)
        .where(
          and(
            eq(schema.whatsappInstances.active, true),
            eq(schema.whatsappInstances.status, "connected"),
            sql`${schema.whatsappInstances.messagesSentLastMinute} < ${schema.whatsappInstances.rateLimitPerMinute}`
          )
        )
        .orderBy(asc(schema.whatsappInstances.lastUsedAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (globalRow) instance = globalRow;
    }
  }

  if (!instance) {
    logger.warn({ messageId }, "outbound: no available instance — will retry");
    throw new Error("no_instance_available"); // BullMQ retries
  }

  // If the conv didn't have a sticky instance, persist the one we picked so
  // future messages on this conversation prefer it.
  if (!conv.whatsappInstanceId) {
    await db
      .update(schema.conversations)
      .set({ whatsappInstanceId: instance.id })
      .where(eq(schema.conversations.id, conversationId));
  }

  const provider = getProvider(instance.provider);
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) throw new Error("ENCRYPTION_KEY env var is required");
  const config = decryptJson(instance.configJson, encKey) as { baseUrl?: string; token?: string };

  try {
    // Branch: media message (PDF/image/video) vs plain text.
    // The send_property tool sets media_url + media_type='document'.
    const result = msg.mediaUrl
      ? await provider.sendMedia(
          {
            to: conv.lead.phone,
            mediaUrl: msg.mediaUrl,
            caption: msg.content || undefined,
            kind: ((): "image" | "audio" | "video" | "document" => {
              const t = msg.mediaType ?? "document";
              return t === "audio" ? "audio" : t === "video" ? "video" : t === "image" ? "image" : "document";
            })()
          },
          config
        )
      : await provider.sendText(
          { to: conv.lead.phone, text: msg.content },
          config
        );

    await Promise.all([
      db
        .update(schema.messages)
        .set({ status: "sent", providerMessageId: result.providerMessageId })
        .where(eq(schema.messages.id, messageId)),
      db
        .update(schema.whatsappInstances)
        .set({
          lastUsedAt: new Date(),
          messagesSentLastMinute: sql`${schema.whatsappInstances.messagesSentLastMinute} + 1`
        })
        .where(eq(schema.whatsappInstances.id, instance.id)),
      db
        .insert(schema.outboundDispatchLog)
        .values({
          id: newId(),
          messageId,
          instanceId: instance.id,
          campaignId: conv.campaignId ?? undefined,
          jobId: String(job),
          attempt: 1,
          status: "sent"
        })
    ]);

    const event = JSON.stringify({
      kind: "message:new",
      conversationId,
      messageId,
      senderType: msg.senderType,
      brokerId: conv.assignedBrokerId
    });
    await publisher.publish(CH.inbox, event);

    logger.info({ messageId, provider: instance.provider }, "outbound: sent");
  } catch (err) {
    logger.error({ messageId, err }, "outbound: send failed");
    await db
      .update(schema.messages)
      .set({ status: "failed" })
      .where(eq(schema.messages.id, messageId));
    throw err; // let BullMQ retry
  }
}
