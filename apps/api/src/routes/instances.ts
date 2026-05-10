import { schema } from "@pointer/db";
import { decryptJson, encryptJson, newId } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db.js";

const instanceBody = z.object({
  provider: z.enum(["uazapi", "meta", "evolution"]),
  number: z.string().min(8),
  rateLimitPerMinute: z.number().int().min(1).max(200).default(20),
  configJson: z.record(z.unknown()).default({})
});

export async function registerInstances(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole("admin")] };
  const authGuard = { preHandler: [app.authenticate] };

  app.get("/whatsapp-instances", authGuard, async () => {
    const db = getDb();
    const rows = await db.query.whatsappInstances.findMany();
    // Decrypt + mask tokens per row. If a single row has malformed/legacy
    // ciphertext, surface a placeholder for THAT row instead of 500ing the
    // whole list (key rotation, hand-edited configJson, etc).
    return {
      instances: rows.map((r) => {
        let configJson: Record<string, unknown>;
        try {
          configJson = maskSecrets(
            decryptJson(r.configJson as Record<string, unknown>, config.ENCRYPTION_KEY)
          );
        } catch (err) {
          app.log.warn(
            { instanceId: r.id, err },
            "decrypt failed for instance configJson — surfacing placeholder"
          );
          configJson = { __error: "decryption_failed" };
        }
        return { ...r, configJson };
      })
    };
  });

  app.post("/whatsapp-instances", adminGuard, async (req, reply) => {
    const body = instanceBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);

    const { normalizeE164 } = await import("@pointer/shared");
    const db = getDb();
    const id = newId();
    const number = normalizeE164(body.data.number);

    // Meta has no QR step — if the access token + phone_number_id resolve on
    // the Graph API, the instance is good to go. We probe immediately and
    // persist the resolved status, so dispatchers (which require
    // status='connected') can use the instance right away.
    let initialStatus: "pending" | "connected" | "disconnected" = "pending";
    let externalId = id;
    let probeError: string | null = null;

    if (body.data.provider === "meta") {
      const cfg = body.data.configJson as {
        phoneNumberId?: string;
        accessToken?: string;
        token?: string;
      };
      const accessToken = cfg.accessToken ?? cfg.token;
      if (!cfg.phoneNumberId || !accessToken) {
        return reply.badRequest("meta requires phoneNumberId + accessToken");
      }
      try {
        const { request } = await import("undici");
        const res = await request(
          `https://graph.facebook.com/v19.0/${encodeURIComponent(cfg.phoneNumberId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (res.statusCode >= 200 && res.statusCode < 300) {
          initialStatus = "connected";
          externalId = cfg.phoneNumberId;
        } else {
          initialStatus = "disconnected";
          const txt = await res.body.text().catch(() => "");
          probeError = `Graph API ${res.statusCode}: ${txt.slice(0, 200)}`;
          app.log.warn(
            { phoneNumberId: cfg.phoneNumberId, status: res.statusCode },
            "meta instance probe failed"
          );
        }
      } catch (err) {
        initialStatus = "disconnected";
        probeError = err instanceof Error ? err.message : String(err);
        app.log.warn({ err }, "meta instance probe threw");
      }
    }

    await db.insert(schema.whatsappInstances).values({
      id,
      provider: body.data.provider,
      externalId,
      number,
      status: initialStatus,
      rateLimitPerMinute: body.data.rateLimitPerMinute,
      configJson: encryptJson(body.data.configJson, config.ENCRYPTION_KEY),
      active: true
    });
    return reply.code(201).send({ id, status: initialStatus, probeError });
  });

  app.patch<{ Params: { id: string } }>("/whatsapp-instances/:id", adminGuard, async (req, reply) => {
    const body = instanceBody.partial().safeParse(req.body);
    if (!body.success) return reply.badRequest();
    const db = getDb();

    const update: Record<string, unknown> = { ...body.data };
    if (update.configJson) {
      update.configJson = encryptJson(
        update.configJson as Record<string, unknown>,
        config.ENCRYPTION_KEY
      );
    }

    await db.update(schema.whatsappInstances).set(update).where(eq(schema.whatsappInstances.id, req.params.id));
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>("/whatsapp-instances/:id/toggle", adminGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.whatsappInstances.findFirst({ where: eq(schema.whatsappInstances.id, req.params.id) });
    if (!row) return reply.notFound();
    await db.update(schema.whatsappInstances).set({ active: !row.active }).where(eq(schema.whatsappInstances.id, row.id));
    return { ok: true, active: !row.active };
  });

  // POST /whatsapp-instances/:id/connect — request QR from Uazapi
  app.post<{ Params: { id: string } }>("/whatsapp-instances/:id/connect", adminGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.whatsappInstances.findFirst({ where: eq(schema.whatsappInstances.id, req.params.id) });
    if (!row) return reply.notFound();
    if (row.provider !== "uazapi") return reply.badRequest("QR connect only supported for uazapi");

    const cfg = decryptJson(row.configJson as Record<string, unknown>, config.ENCRYPTION_KEY) as {
      baseUrl?: string;
      token?: string;
    };
    if (!cfg.baseUrl || !cfg.token) return reply.badRequest("missing baseUrl or token in configJson");

    const { request } = await import("undici");
    const res = await request(`${cfg.baseUrl}/instance/init`, {
      method: "POST",
      headers: { token: cfg.token, "content-type": "application/json" },
      body: JSON.stringify({ instanceName: row.externalId })
    });
    const body = await res.body.json() as any;
    const qr: string | undefined = body?.qrcode ?? body?.qr ?? body?.base64;

    await db.update(schema.whatsappInstances).set({ status: "pending" }).where(eq(schema.whatsappInstances.id, row.id));
    return { qr: qr ?? null, raw: body };
  });

  // GET /whatsapp-instances/:id/qr — poll QR from Uazapi
  app.get<{ Params: { id: string } }>("/whatsapp-instances/:id/qr", authGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.whatsappInstances.findFirst({ where: eq(schema.whatsappInstances.id, req.params.id) });
    if (!row) return reply.notFound();

    const cfg = decryptJson(row.configJson as Record<string, unknown>, config.ENCRYPTION_KEY) as {
      baseUrl?: string;
      token?: string;
    };
    if (!cfg.baseUrl || !cfg.token) return reply.badRequest("missing config");

    const { request } = await import("undici");
    const res = await request(`${cfg.baseUrl}/instance/qr`, {
      headers: { token: cfg.token }
    });
    const body = await res.body.json() as any;
    return { qr: body?.qrcode ?? body?.qr ?? body?.base64 ?? null, status: row.status };
  });

  // POST /whatsapp-instances/:id/refresh-status — query the provider for the
  // real connection state and reconcile our DB. Used when the user connected
  // the number on the Uazapi side directly (without going through our QR
  // flow) and our DB is stuck on `pending`.
  app.post<{ Params: { id: string } }>(
    "/whatsapp-instances/:id/refresh-status",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const row = await db.query.whatsappInstances.findFirst({
        where: eq(schema.whatsappInstances.id, req.params.id)
      });
      if (!row) return reply.notFound();

      // Meta: probe Graph API; if 2xx → connected, else disconnected.
      if (row.provider === "meta") {
        const cfgM = decryptJson(
          row.configJson as Record<string, unknown>,
          config.ENCRYPTION_KEY
        ) as { phoneNumberId?: string; accessToken?: string; token?: string };
        const accessToken = cfgM.accessToken ?? cfgM.token;
        if (!cfgM.phoneNumberId || !accessToken) {
          return reply.badRequest("missing phoneNumberId or accessToken");
        }
        const { request } = await import("undici");
        let httpStatus = 0;
        let bodyText = "";
        let networkError: string | null = null;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8000);
        try {
          const probe = await request(
            `https://graph.facebook.com/v19.0/${encodeURIComponent(cfgM.phoneNumberId)}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: ac.signal,
              headersTimeout: 8000,
              bodyTimeout: 8000
            }
          );
          httpStatus = probe.statusCode;
          bodyText = await probe.body.text().catch(() => "");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          networkError = ac.signal.aborted
            ? `timeout após 8s — Graph API não respondeu (verifique conectividade/firewall)`
            : msg;
        } finally {
          clearTimeout(timer);
        }
        const ok = httpStatus >= 200 && httpStatus < 300;
        const next = ok ? "connected" : "disconnected";
        await db
          .update(schema.whatsappInstances)
          .set({ status: next })
          .where(eq(schema.whatsappInstances.id, row.id));
        const probeError = ok
          ? null
          : networkError
          ? `network: ${networkError}`
          : `Graph API ${httpStatus}: ${bodyText.slice(0, 400)}`;
        return {
          status: next,
          probedPath: `graph.facebook.com/v19.0/${cfgM.phoneNumberId}`,
          probeError,
          raw: { httpStatus }
        };
      }

      if (row.provider !== "uazapi") {
        return reply.badRequest("refresh-status only supported for uazapi/meta");
      }

      const cfg = decryptJson(
        row.configJson as Record<string, unknown>,
        config.ENCRYPTION_KEY
      ) as { baseUrl?: string; token?: string };
      if (!cfg.baseUrl || !cfg.token) {
        return reply.badRequest("missing baseUrl or token in configJson");
      }

      const { request } = await import("undici");

      // Try the common Uazapi status paths in order; first one that responds
      // 2xx wins. Different self-hosted Uazapi forks use slightly different
      // routes (no canonical OpenAPI spec).
      const candidates = [
        "/instance/status",
        "/instance/info",
        `/instance/status/${encodeURIComponent(row.externalId)}`,
        `/instance/${encodeURIComponent(row.externalId)}`
      ];

      let raw: unknown = null;
      let probedPath: string | null = null;
      for (const path of candidates) {
        try {
          const res = await request(`${cfg.baseUrl}${path}`, {
            method: "GET",
            headers: { token: cfg.token }
          });
          if (res.statusCode >= 400) continue;
          raw = await res.body.json().catch(() => null);
          probedPath = path;
          break;
        } catch {
          // try next
        }
      }

      if (!raw) {
        return reply.badRequest(
          "could not reach uazapi status endpoint — check baseUrl/token"
        );
      }

      // Map provider state → our enum. Uazapi forks return varying shapes:
      //   { instance: { state: "open" } }
      //   { state: "CONNECTED" }
      //   { connected: true }
      //   { status: "qr" | "open" | "close" }
      const r = raw as Record<string, unknown>;
      const inner = (r.instance ?? r.data ?? r) as Record<string, unknown>;
      const stateRaw = String(
        inner.state ?? inner.status ?? r.state ?? r.status ?? ""
      ).toLowerCase();
      const connectedFlag =
        inner.connected === true || r.connected === true || r.isConnected === true;

      let nextStatus: "connected" | "pending" | "disconnected";
      if (
        connectedFlag ||
        ["open", "connected", "online", "connected_open"].includes(stateRaw)
      ) {
        nextStatus = "connected";
      } else if (
        ["close", "closed", "disconnected", "offline", "logged_out"].includes(stateRaw)
      ) {
        nextStatus = "disconnected";
      } else {
        // qr, qr_required, connecting, pending, unknown
        nextStatus = "pending";
      }

      await db
        .update(schema.whatsappInstances)
        .set({ status: nextStatus })
        .where(eq(schema.whatsappInstances.id, row.id));

      return { status: nextStatus, probedPath, raw };
    }
  );

  // GET /whatsapp-instances/:id/meta-templates — list message templates from
  // the WhatsApp Business Account behind a Meta instance. Used by the
  // campaign editor to pick the approved template for outbound first-touch.
  // We only proxy the read, never cache server-side — the source of truth
  // is the WhatsApp Manager.
  app.get<{
    Params: { id: string };
    Querystring: { status?: string };
  }>("/whatsapp-instances/:id/meta-templates", authGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.whatsappInstances.findFirst({
      where: eq(schema.whatsappInstances.id, req.params.id)
    });
    if (!row) return reply.notFound();
    if (row.provider !== "meta") {
      return reply.badRequest("templates only supported for meta provider");
    }

    const cfg = decryptJson(
      row.configJson as Record<string, unknown>,
      config.ENCRYPTION_KEY
    ) as { businessAccountId?: string; accessToken?: string; token?: string };
    const wabaId = cfg.businessAccountId;
    const accessToken = cfg.accessToken ?? cfg.token;
    if (!wabaId || !accessToken) {
      return reply.badRequest("missing businessAccountId or accessToken");
    }

    const { request } = await import("undici");
    // Pull a generous batch — most accounts have <50 templates.
    const url =
      `https://graph.facebook.com/v19.0/${encodeURIComponent(wabaId)}/message_templates` +
      `?fields=name,language,status,category,components&limit=200`;
    const res = await request(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.statusCode >= 400) {
      const text = await res.body.text().catch(() => "");
      return reply.code(502).send({
        error: "graph_api_error",
        statusCode: res.statusCode,
        body: text.slice(0, 500)
      });
    }
    const body = (await res.body.json()) as {
      data?: Array<{
        name: string;
        language: string;
        status: string;
        category?: string;
        components?: Array<Record<string, unknown>>;
      }>;
    };

    const all = body.data ?? [];
    const filterStatus = req.query.status?.toUpperCase();
    const filtered = filterStatus
      ? all.filter((t) => t.status?.toUpperCase() === filterStatus)
      : all;

    // Surface body-component param count + names + header media info so the
    // UI can render the right slots without re-parsing on the client.
    const enriched = filtered.map((t) => {
      const body = (t.components ?? []).find(
        (c: any) => String(c.type).toUpperCase() === "BODY"
      ) as { text?: string } | undefined;
      const header = (t.components ?? []).find(
        (c: any) => String(c.type).toUpperCase() === "HEADER"
      ) as { format?: string } | undefined;
      // Templates may use positional `{{1}}` OR named `{{nome}}` placeholders
      // (Meta's Q1-2024 named-params feature). We surface both so the UI can
      // render a slot per placeholder and stamp `parameter_name` on send.
      const positional = body?.text
        ? Array.from(body.text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => m[1])
        : [];
      const named = body?.text
        ? Array.from(body.text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)).map(
            (m) => m[1]
          )
        : [];
      const placeholderNames = named.length ? named : positional;
      const headerFormat = (header?.format ?? "").toUpperCase();
      return {
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category ?? null,
        bodyText: body?.text ?? null,
        bodyParamCount: placeholderNames.length,
        bodyParamNames: named.length ? named : null,
        headerFormat:
          headerFormat === "VIDEO" || headerFormat === "IMAGE" || headerFormat === "DOCUMENT"
            ? (headerFormat as "VIDEO" | "IMAGE" | "DOCUMENT")
            : headerFormat === "TEXT"
            ? ("TEXT" as const)
            : null
      };
    });

    return { templates: enriched };
  });

  // POST /whatsapp-instances/:id/test-send — fire one template message to a
  // chosen recipient. Admin-only. Useful for proving end-to-end delivery
  // before wiring a campaign. Bypasses the BullMQ queue and rate-limit.
  app.post<{
    Params: { id: string };
    Body: {
      to: string;
      template: string;
      language?: string;
      // Shortcut for body-only positional params: ["foo","bar"] → [{type:text,text:foo},...]
      params?: string[];
      // Full Meta components array — wins over `params` when present.
      // Lets the UI build header media + named body params.
      components?: Array<Record<string, unknown>>;
    };
  }>("/whatsapp-instances/:id/test-send", adminGuard, async (req, reply) => {
    const { to, template, language, params, components: rawComponents } =
      req.body ?? ({} as any);
    if (!to || !template) {
      return reply.badRequest("to and template are required");
    }
    const db = getDb();
    const row = await db.query.whatsappInstances.findFirst({
      where: eq(schema.whatsappInstances.id, req.params.id)
    });
    if (!row) return reply.notFound();
    if (row.provider !== "meta") {
      return reply.badRequest("test-send only wired for meta provider here");
    }
    const cfg = decryptJson(
      row.configJson as Record<string, unknown>,
      config.ENCRYPTION_KEY
    ) as { phoneNumberId?: string; accessToken?: string; token?: string };
    const phoneNumberId = cfg.phoneNumberId;
    const accessToken = cfg.accessToken ?? cfg.token;
    if (!phoneNumberId || !accessToken) {
      return reply.badRequest("instance config missing phoneNumberId or accessToken");
    }
    const { request } = await import("undici");
    let components: Array<Record<string, unknown>>;
    if (Array.isArray(rawComponents) && rawComponents.length) {
      components = rawComponents;
    } else if ((params ?? []).length) {
      components = [
        {
          type: "body",
          parameters: (params ?? []).map((text) => ({ type: "text", text }))
        }
      ];
    } else {
      components = [];
    }
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: template,
        language: { code: language ?? "pt_BR" },
        ...(components.length ? { components } : {})
      }
    };
    const res = await request(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );
    const responseBody = await res.body.json().catch(() => ({}));

    // Surface common silent-failure causes alongside the raw response so the
    // UI can show actionable hints instead of a generic "accepted" lie.
    const phoneInfoRes = await request(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}` +
        `?fields=name_status,quality_rating,account_mode,code_verification_status`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    ).catch(() => null);
    const phoneInfo = phoneInfoRes
      ? await phoneInfoRes.body.json().catch(() => ({}))
      : {};

    return reply.code(res.statusCode).send({
      httpStatus: res.statusCode,
      ok: res.statusCode >= 200 && res.statusCode < 300,
      payloadSent: payload,
      response: responseBody,
      senderHealth: phoneInfo
    });
  });

  // POST /whatsapp-instances/:id/upload-media — proxy a multipart file upload
  // to the Meta Graph `/{phone_number_id}/media` endpoint, returning the
  // resulting media_id. Used by the campaign editor to bind a header video
  // (or image/document) to a Meta HSM template without leaving the UI.
  // Meta retains the asset for ~30 days; users re-upload when it expires.
  app.post<{ Params: { id: string } }>(
    "/whatsapp-instances/:id/upload-media",
    adminGuard,
    async (req, reply) => {
      const data = await req.file().catch(() => null);
      if (!data) return reply.badRequest("missing file");
      const buf = await data.toBuffer();
      if (buf.length === 0) return reply.badRequest("empty file");

      const mime = data.mimetype || "application/octet-stream";
      // Meta only accepts a curated allowlist per asset class; we let the
      // Graph API reject unsupported types so we don't drift from their docs.
      const allowed = /^(video|image|application|audio)\//.test(mime);
      if (!allowed) return reply.badRequest(`unsupported mimetype: ${mime}`);

      const db = getDb();
      const row = await db.query.whatsappInstances.findFirst({
        where: eq(schema.whatsappInstances.id, req.params.id)
      });
      if (!row) return reply.notFound();
      if (row.provider !== "meta") {
        return reply.badRequest("upload-media only supported for meta provider");
      }
      const cfg = decryptJson(
        row.configJson as Record<string, unknown>,
        config.ENCRYPTION_KEY
      ) as { phoneNumberId?: string; accessToken?: string; token?: string };
      const phoneNumberId = cfg.phoneNumberId;
      const accessToken = cfg.accessToken ?? cfg.token;
      if (!phoneNumberId || !accessToken) {
        return reply.badRequest("instance config missing phoneNumberId or accessToken");
      }

      const { request, FormData } = await import("undici");
      const fd = new FormData();
      fd.append("messaging_product", "whatsapp");
      fd.append("type", mime);
      // Node's global File is available in Node 18+; FormData in undici
      // requires a Blob/File for binary bodies (passing a Buffer alone
      // gets serialized as a string, which Meta rejects).
      const file = new File([new Uint8Array(buf)], data.filename ?? "upload", {
        type: mime
      });
      fd.append("file", file);

      const res = await request(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}/media`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: fd
        }
      );
      const body = (await res.body.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string; code?: number };
      };
      if (res.statusCode >= 400 || !body.id) {
        return reply.code(502).send({
          error: "graph_api_error",
          httpStatus: res.statusCode,
          response: body
        });
      }
      return {
        id: body.id,
        size: buf.length,
        mimetype: mime,
        filename: data.filename ?? null
      };
    }
  );

  app.delete<{ Params: { id: string } }>("/whatsapp-instances/:id", adminGuard, async (req, reply) => {
    const db = getDb();
    await db.delete(schema.whatsappInstances).where(eq(schema.whatsappInstances.id, req.params.id));
    return reply.code(204).send();
  });
}

function maskSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const SECRET_KEYS = ["token", "secret", "password", "apiKey", "api_key", "webhookSecret"];
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      SECRET_KEYS.some((s) => k.toLowerCase().includes(s)) ? [k, "••••••••"] : [k, v]
    )
  );
}
