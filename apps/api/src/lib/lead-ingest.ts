import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import type { Queues } from "@pointer/queue";
import { newId, normalizeE164 } from "@pointer/shared";
import { and, eq } from "drizzle-orm";
import { resolveDefaultStageId } from "./pipeline.js";
import { pickBroker } from "./round-robin.js";

type ZapPayload = Record<string, unknown>;

function normalize(p: ZapPayload) {
  const rawPhone =
    (p.LeadTelephone ?? p.phone ?? p.telephone ?? p.celular ?? "") as string;

  // BusinessType from OLX/ZAP — array or string. Normalize to lowercase tags.
  const rawBusinessType = (p.BusinessType ?? p.businessType ?? null) as
    | string
    | string[]
    | null;
  const businessType = Array.isArray(rawBusinessType)
    ? rawBusinessType.map((t) => String(t).toLowerCase())
    : typeof rawBusinessType === "string"
      ? [rawBusinessType.toLowerCase()]
      : [];

  return {
    name: ((p.LeadName ?? p.name ?? p.nome ?? null) as string | null)?.trim() || null,
    email: ((p.LeadEmail ?? p.email ?? null) as string | null)?.toLowerCase().trim() || null,
    phone: normalizeE164(rawPhone),
    origin: ((p.LeadOrigin ?? p.origin ?? p.origem ?? null) as string | null) ?? null,
    propertyRef:
      ((p.PropertyId ?? p.propertyRef ?? p.imovel ?? null) as string | null) ?? null,
    message: ((p.Message ?? p.message ?? p.mensagem ?? null) as string | null) ?? null,
    externalId: ((p.ExternalId ?? p.externalId ?? p.id ?? null) as string | null) ?? null,
    /** OLX/ZAP convention: ["SALE"] | ["RENTAL"] | both. */
    businessType,
    /** OLX/ZAP convention: route directly to a specific broker by email. */
    brokerEmail: ((p.BrokerEmail ?? p.brokerEmail ?? null) as string | null)?.toLowerCase().trim() ?? null
  };
}

export async function ingestLead(
  db: Database,
  queues: Queues,
  sourceId: string,
  payload: ZapPayload
): Promise<{ leadId: string; conversationId: string; isNew: boolean }> {
  const data = normalize(payload);

  let lead = data.externalId
    ? await db.query.leads.findFirst({
        where: and(
          eq(schema.leads.sourceId, sourceId),
          eq(schema.leads.externalId, data.externalId)
        )
      })
    : await db.query.leads.findFirst({
        where: and(
          eq(schema.leads.sourceId, sourceId),
          eq(schema.leads.phone, data.phone)
        )
      });

  // Resolve broker: explicit BrokerEmail (OLX/ZAP) > round-robin
  let brokerId: string | null = null;
  if (data.brokerEmail) {
    const matchedUser = await db.query.users.findFirst({
      where: eq(schema.users.email, data.brokerEmail),
      columns: { id: true }
    });
    if (matchedUser) {
      const matchedBroker = await db.query.brokers.findFirst({
        where: eq(schema.brokers.userId, matchedUser.id),
        columns: { id: true }
      });
      brokerId = matchedBroker?.id ?? null;
    }
  }
  if (!brokerId) brokerId = (await pickBroker(db)) ?? null;

  if (!lead) {
    const stageId = await resolveDefaultStageId(db);
    const leadId = newId();
    await db.insert(schema.leads).values({
      id: leadId,
      sourceId,
      externalId: data.externalId ?? undefined,
      name: data.name ?? undefined,
      email: data.email ?? undefined,
      phone: data.phone,
      propertyRef: data.propertyRef ?? undefined,
      origin: data.origin ?? undefined,
      metadataJson: {
        rawPayload: payload,
        businessType: data.businessType,
        brokerEmail: data.brokerEmail ?? undefined
      },
      pipelineStageId: stageId,
      assignedBrokerId: brokerId ?? undefined
    });
    lead = (await db.query.leads.findFirst({ where: eq(schema.leads.id, leadId) }))!;
  } else {
    await db
      .update(schema.leads)
      .set({
        name: data.name ?? lead.name ?? undefined,
        email: data.email ?? lead.email ?? undefined
      })
      .where(eq(schema.leads.id, lead.id));
  }

  let conv = await db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.leadId, lead.id),
      eq(schema.conversations.status, "ai_active")
    )
  });

  const isNew = !conv;
  if (!conv) {
    const instance = await db.query.whatsappInstances.findFirst({
      where: and(
        eq(schema.whatsappInstances.active, true),
        eq(schema.whatsappInstances.status, "connected")
      )
    });

    // Default agent for ad-hoc inbound (no campaign): first active inbound agent.
    const inboundAgent = await db.query.agents.findFirst({
      where: and(eq(schema.agents.active, true), eq(schema.agents.type, "inbound"))
    });

    const convId = newId();
    await db.insert(schema.conversations).values({
      id: convId,
      leadId: lead.id,
      status: "ai_active",
      mode: "inbound",
      assignedBrokerId: brokerId ?? undefined,
      whatsappInstanceId: instance?.id ?? undefined,
      agentId: inboundAgent?.id ?? undefined,
      aiPaused: false,
      lastMessageAt: new Date()
    });
    conv = (await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, convId)
    }))!;
  }

  await queues.aiReply.add(`first-touch:${conv.id}`, {
    conversationId: conv.id,
    mode: "inbound",
    firstTouch: isNew,
    trigger: {
      kind: "webhook_inbound",
      refId: data.externalId ?? data.phone
    },
    reason: `lead-ingest:${data.externalId ?? data.phone}`
  });

  return { leadId: lead.id, conversationId: conv.id, isNew };
}
