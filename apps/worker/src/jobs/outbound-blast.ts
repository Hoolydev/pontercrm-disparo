import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import type { OutboundBlastJob } from "@pointer/queue";
import { getQueues } from "@pointer/queue";
import { newId } from "@pointer/shared";
import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";

/**
 * Per-lead dispatcher. Runs once for each campaign_leads row queued by the
 * seeder. Validates active state, creates (or finds) an outbound conversation,
 * marks the row dispatched, and hands off to ai-reply with mode='outbound'.
 *
 * The actual WhatsApp send is delegated to outbound-message via the engine —
 * this job only sets up the conversation and triggers the AI's first turn.
 */
export async function processOutboundBlast(
  job: OutboundBlastJob,
  db: Database,
  logger: Logger
) {
  const { campaignId, campaignLeadId } = job;

  const cl = await db.query.campaignLeads.findFirst({
    where: eq(schema.campaignLeads.id, campaignLeadId)
  });
  if (!cl) {
    logger.warn({ campaignLeadId }, "blast: campaign_leads row missing — skip");
    return;
  }
  if (cl.state !== "queued") {
    logger.info({ campaignLeadId, state: cl.state }, "blast: not queued — skip");
    return;
  }

  const camp = await db.query.campaigns.findFirst({
    where: eq(schema.campaigns.id, campaignId)
  });
  if (!camp || camp.status !== "active") {
    logger.info(
      { campaignId, status: camp?.status },
      "blast: campaign not active — re-queue or drop"
    );
    // If paused, leave row in 'queued' so resume can re-process.
    return;
  }
  if (!camp.outboundAgentId) {
    await markFailure(db, campaignLeadId, "campaign has no outbound agent");
    return;
  }

  // Idempotency: if a conversation for (lead, campaign) already exists, reuse.
  let conv = await db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.leadId, cl.leadId),
      eq(schema.conversations.campaignId, campaignId)
    )
  });

  if (!conv) {
    // Pick a whatsapp instance from the campaign's pool.
    const instance = await pickInstanceForCampaign(db, campaignId);
    if (!instance) {
      // No instance available right now — fail the job so BullMQ retries.
      throw new Error("no_campaign_instance_available");
    }

    // Resolve broker via lead.assignedBrokerId or null (round-robin happens at lead ingest).
    const lead = await db.query.leads.findFirst({
      where: eq(schema.leads.id, cl.leadId),
      columns: { id: true, assignedBrokerId: true }
    });

    const convId = newId();
    await db.insert(schema.conversations).values({
      id: convId,
      leadId: cl.leadId,
      campaignId,
      status: "ai_active",
      mode: "outbound_seed",
      assignedBrokerId: lead?.assignedBrokerId ?? undefined,
      agentId: camp.outboundAgentId,
      whatsappInstanceId: instance.id,
      aiPaused: false,
      lastMessageAt: new Date()
    });
    conv = (await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, convId)
    }))!;
  }

  await db
    .update(schema.campaignLeads)
    .set({ state: "dispatched", attemptedAt: new Date() })
    .where(eq(schema.campaignLeads.id, campaignLeadId));

  await getQueues().aiReply.add(
    `seed-${conv.id}`,
    {
      conversationId: conv.id,
      mode: "outbound",
      firstTouch: true,
      trigger: { kind: "campaign_seed", refId: campaignLeadId }
    },
    { jobId: `seed-${conv.id}` }
  );

  logger.info(
    { campaignId, campaignLeadId, conversationId: conv.id },
    "blast: dispatched"
  );
}

async function pickInstanceForCampaign(db: Database, campaignId: string) {
  // Pool: campaign_instances ∩ active connected whatsapp_instances, prefer least-recently-used.
  // Drizzle Query API doesn't compose joins as ergonomically here, so use raw select.
  const rows = await db
    .select({
      id: schema.whatsappInstances.id,
      lastUsedAt: schema.whatsappInstances.lastUsedAt
    })
    .from(schema.whatsappInstances)
    .innerJoin(
      schema.campaignInstances,
      eq(schema.campaignInstances.instanceId, schema.whatsappInstances.id)
    )
    .where(
      and(
        eq(schema.campaignInstances.campaignId, campaignId),
        eq(schema.whatsappInstances.active, true),
        eq(schema.whatsappInstances.status, "connected")
      )
    )
    .orderBy(schema.whatsappInstances.lastUsedAt)
    .limit(1);

  return rows[0] ?? null;
}

async function markFailure(db: Database, campaignLeadId: string, error: string) {
  await db
    .update(schema.campaignLeads)
    .set({ state: "failed", lastError: error, attemptedAt: new Date() })
    .where(eq(schema.campaignLeads.id, campaignLeadId));
}
