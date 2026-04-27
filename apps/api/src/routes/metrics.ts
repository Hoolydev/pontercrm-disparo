import { schema } from "@pointer/db";
import { count, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

export async function registerMetrics(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireRole("admin", "supervisor")] };

  app.get("/metrics/overview", guard, async () => {
    const db = getDb();
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const [
      totalLeads,
      newLeads24h,
      totalConvs,
      activeConvs,
      handedOffConvs,
      totalMessages24h,
      aiMessages24h,
      brokerMessages24h,
      handoffs7d
    ] = await Promise.all([
      db.select({ n: count() }).from(schema.leads).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.leads).where(gte(schema.leads.createdAt, since24h)).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.conversations).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.conversations).where(eq(schema.conversations.status, "ai_active")).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.conversations).where(eq(schema.conversations.status, "handed_off")).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.messages).where(gte(schema.messages.createdAt, since24h)).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.messages).where(sql`${schema.messages.senderType} = 'ai' AND ${schema.messages.createdAt} >= ${since24h}`).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.messages).where(sql`${schema.messages.senderType} = 'broker' AND ${schema.messages.createdAt} >= ${since24h}`).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(schema.conversations).where(sql`${schema.conversations.handoffReason} IS NOT NULL AND ${schema.conversations.updatedAt} >= ${since7d}`).then((r) => r[0]?.n ?? 0)
    ]);

    return {
      leads: { total: totalLeads, last24h: newLeads24h },
      conversations: { total: totalConvs, aiActive: activeConvs, handedOff: handedOffConvs },
      messages: { last24h: totalMessages24h, ai: aiMessages24h, broker: brokerMessages24h },
      handoffs: { last7d: handoffs7d }
    };
  });

  app.get("/metrics/brokers", guard, async () => {
    const db = getDb();
    const brokers = await db.query.brokers.findMany({
      with: { conversations: { columns: { id: true, status: true } } }
    });
    return {
      brokers: brokers.map((b) => ({
        id: b.id,
        displayName: b.displayName,
        active: b.active,
        activeConversations: b.conversations.filter((c) => c.status !== "closed").length,
        totalConversations: b.conversations.length
      }))
    };
  });

  app.get("/metrics/instances", guard, async () => {
    const db = getDb();
    const instances = await db.query.whatsappInstances.findMany();
    return { instances: instances.map((i) => ({
      id: i.id, provider: i.provider, number: i.number,
      status: i.status, messagesSentLastMinute: i.messagesSentLastMinute,
      rateLimitPerMinute: i.rateLimitPerMinute, active: i.active
    })) };
  });

  // Per-campaign aggregate: counts of campaign_leads by state, conversation
  // status breakdown, and computed reply rate.
  app.get("/metrics/campaigns", guard, async () => {
    const db = getDb();

    const campaigns = await db.query.campaigns.findMany({
      orderBy: [desc(schema.campaigns.createdAt)],
      columns: { id: true, name: true, status: true, createdAt: true }
    });
    if (campaigns.length === 0) return { campaigns: [] };

    const stateRows = await db
      .select({
        campaignId: schema.campaignLeads.campaignId,
        state: schema.campaignLeads.state,
        n: count()
      })
      .from(schema.campaignLeads)
      .groupBy(schema.campaignLeads.campaignId, schema.campaignLeads.state);

    const convRows = await db
      .select({
        campaignId: schema.conversations.campaignId,
        status: schema.conversations.status,
        n: count()
      })
      .from(schema.conversations)
      .where(sql`${schema.conversations.campaignId} IS NOT NULL`)
      .groupBy(schema.conversations.campaignId, schema.conversations.status);

    const byCampaign = new Map<string, {
      states: Record<string, number>;
      conversations: Record<string, number>;
    }>();
    for (const c of campaigns) byCampaign.set(c.id, { states: {}, conversations: {} });
    for (const r of stateRows) {
      const slot = byCampaign.get(r.campaignId);
      if (slot) slot.states[r.state] = Number(r.n);
    }
    for (const r of convRows) {
      if (!r.campaignId) continue;
      const slot = byCampaign.get(r.campaignId);
      if (slot) slot.conversations[r.status] = Number(r.n);
    }

    return {
      campaigns: campaigns.map((c) => {
        const slot = byCampaign.get(c.id)!;
        const dispatched = (slot.states.dispatched ?? 0) + (slot.states.replied ?? 0);
        const replied = slot.states.replied ?? 0;
        const replyRate = dispatched > 0 ? replied / dispatched : 0;
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          createdAt: c.createdAt,
          campaignLeads: slot.states,
          conversations: slot.conversations,
          replyRate
        };
      })
    };
  });
}
