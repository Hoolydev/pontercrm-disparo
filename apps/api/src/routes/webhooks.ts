import { schema } from "@pointer/db";
import { getProvider } from "@pointer/providers";
import { getQueues } from "@pointer/queue";
import { newId, sha256 } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ingestLead } from "../lib/lead-ingest.js";
import { verifyLeadSourceAuth, type LeadSourceAuth } from "../plugins/hmac.js";
import { getDb } from "../db.js";

export async function registerWebhooks(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body: string, done) => {
      try {
        const parsed = JSON.parse(body || "{}");
        (parsed as any).__rawBody = body;
        done(null, parsed);
      } catch (err) {
        done(err as Error);
      }
    }
  );

  // ─── Inbound lead from portal (ZAP / VivaReal / site) ────────────────────
  app.post<{ Params: { sourceId: string } }>(
    "/webhooks/leads/:sourceId",
    async (req, reply) => {
      const db = getDb();
      const source = await db.query.leadSources.findFirst({
        where: eq(schema.leadSources.id, req.params.sourceId)
      });
      if (!source?.active) return reply.notFound();

      const payload = req.body as Record<string, unknown>;
      const raw: string = (payload.__rawBody as string | undefined) ?? JSON.stringify(payload);

      // Per-source auth mode (config_json.auth). Defaults to HMAC for back-compat.
      const cfg = (source.configJson ?? {}) as { auth?: LeadSourceAuth };
      const authSpec: LeadSourceAuth = cfg.auth ?? { mode: "hmac" };
      if (!verifyLeadSourceAuth(req, raw, source.webhookSecret, authSpec)) {
        return reply.unauthorized();
      }

      const externalId =
        (payload.ExternalId as string | undefined) ??
        (payload.externalId as string | undefined) ??
        sha256(raw).slice(0, 24);
      const dedupeKey = `lead:${source.id}:${externalId}`;

      try {
        await db.insert(schema.webhookEvents).values({
          id: newId(),
          provider: `lead-source:${source.type}`,
          source: source.id,
          dedupeKey,
          rawPayload: payload,
          processedAt: new Date()
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("webhook_events_dedupe_key_uq")) {
          return reply.code(200).send({ ok: true, dedup: true });
        }
        throw err;
      }

      const { leadId, conversationId, isNew } = await ingestLead(
        db,
        getQueues(),
        source.id,
        payload
      );

      req.log.info({ leadId, conversationId, isNew, dedupeKey }, "lead ingested");
      return reply.code(isNew ? 201 : 200).send({ ok: true, leadId, conversationId, isNew });
    }
  );

  // ─── Inbound WhatsApp message ─────────────────────────────────────────────
  app.post<{ Params: { provider: string; instanceId: string } }>(
    "/webhooks/whatsapp/:provider/:instanceId",
    async (req, reply) => {
      const { provider, instanceId } = req.params;
      const db = getDb();

      const instance = await db.query.whatsappInstances.findFirst({
        where: eq(schema.whatsappInstances.id, instanceId)
      });
      if (!instance?.active) return reply.notFound();

      const payload = req.body as Record<string, unknown>;

      let adapter;
      try {
        adapter = getProvider(instance.provider);
      } catch {
        return reply.badRequest("unsupported provider");
      }

      const parsed = adapter.parseWebhook(payload, req.headers as Record<string, string>);
      if (parsed.kind !== "message") return reply.code(200).send({ ok: true });

      const { message } = parsed;
      const dedupeKey = `wa:${instance.id}:${message.providerMessageId}`;

      try {
        await db.insert(schema.webhookEvents).values({
          id: newId(),
          provider: `whatsapp:${provider}`,
          source: instance.id,
          dedupeKey,
          rawPayload: payload,
          processedAt: new Date()
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("webhook_events_dedupe_key_uq")) {
          return reply.code(200).send({ ok: true, dedup: true });
        }
        throw err;
      }

      await getQueues().inboundMessage.add(`msg-${dedupeKey}`, {
        webhookEventId: dedupeKey,
        provider,
        instanceId: instance.id,
        fromPhone: message.fromPhone,
        content: message.content,
        mediaUrl: message.mediaUrl,
        providerMessageId: message.providerMessageId,
        receivedAt: message.timestamp.toISOString()
      }, { jobId: `msg-${dedupeKey}` });

      return reply.code(200).send({ ok: true });
    }
  );
}
