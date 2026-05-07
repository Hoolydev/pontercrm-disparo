import { schema } from "@pointer/db";
import { getProvider } from "@pointer/providers";
import { getQueues } from "@pointer/queue";
import { decryptJson, newId, sha256 } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { config as appConfig } from "../config.js";
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

  // ─── Meta Cloud API webhook handshake ─────────────────────────────────────
  // Meta does a one-time GET on the callback URL when you hit "Verify and
  // save" in the Developer Console. We must echo back hub.challenge iff
  // hub.verify_token matches the verifyToken stored in the instance config.
  app.get<{
    Params: { provider: string; instanceId: string };
    Querystring: {
      "hub.mode"?: string;
      "hub.challenge"?: string;
      "hub.verify_token"?: string;
    };
  }>(
    "/webhooks/whatsapp/:provider/:instanceId",
    async (req, reply) => {
      const { provider, instanceId } = req.params;
      if (provider !== "meta") return reply.notFound();

      const mode = req.query["hub.mode"];
      const challenge = req.query["hub.challenge"];
      const token = req.query["hub.verify_token"];
      if (mode !== "subscribe" || !challenge || !token) {
        return reply.badRequest("missing hub params");
      }

      const db = getDb();
      const instance = await db.query.whatsappInstances.findFirst({
        where: eq(schema.whatsappInstances.id, instanceId)
      });
      if (!instance?.active) return reply.notFound();

      let cfg: { verifyToken?: string };
      try {
        cfg = decryptJson(
          instance.configJson as Record<string, unknown>,
          appConfig.ENCRYPTION_KEY
        ) as { verifyToken?: string };
      } catch {
        return reply.code(500).send({ error: "config decryption failed" });
      }

      if (!cfg.verifyToken || cfg.verifyToken !== token) {
        req.log.warn(
          { instanceId },
          "meta webhook handshake: verify_token mismatch"
        );
        return reply.code(403).send({ error: "verify_token mismatch" });
      }

      reply.type("text/plain");
      return reply.code(200).send(challenge);
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

      // Meta signs every POST with HMAC-SHA256 over the raw body using the
      // App Secret (X-Hub-Signature-256). If the instance has an appSecret
      // configured, refuse payloads that don't match — otherwise anyone who
      // learns the URL can inject fake messages.
      if (instance.provider === "meta") {
        let cfg: { appSecret?: string };
        try {
          cfg = decryptJson(
            instance.configJson as Record<string, unknown>,
            appConfig.ENCRYPTION_KEY
          ) as { appSecret?: string };
        } catch {
          return reply.code(500).send({ error: "config decryption failed" });
        }
        if (cfg.appSecret) {
          const rawBody =
            (payload.__rawBody as string | undefined) ?? JSON.stringify(payload);
          const ok = adapter.verifySignature(
            rawBody,
            req.headers as Record<string, string>,
            { appSecret: cfg.appSecret }
          );
          if (!ok) {
            req.log.warn({ instanceId }, "meta webhook: bad signature");
            return reply.code(401).send({ error: "bad signature" });
          }
        }
      }

      const parsed = adapter.parseWebhook(payload, req.headers as Record<string, string>);
      if (parsed.kind !== "message") {
        // Persist anyway so we can diagnose unrecognized payloads after the
        // fact (parser returning "ignored" used to drop silently with 200 OK).
        try {
          await db.insert(schema.webhookEvents).values({
            id: newId(),
            provider: `whatsapp:${provider}`,
            source: instance.id,
            dedupeKey: `wa-ignored:${instance.id}:${sha256(JSON.stringify(payload)).slice(0, 16)}`,
            rawPayload: payload,
            processedAt: new Date()
          });
        } catch {
          // Dedupe collision on identical payload — ignore.
        }
        req.log.warn(
          { instanceId, kind: parsed.kind, sample: JSON.stringify(payload).slice(0, 500) },
          "webhook: payload not recognized as message — stored for diagnosis"
        );
        return reply.code(200).send({ ok: true, ignored: true });
      }

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
      }, { jobId: `msg-${dedupeKey}`.replaceAll(":", "-") });

      return reply.code(200).send({ ok: true });
    }
  );
}
