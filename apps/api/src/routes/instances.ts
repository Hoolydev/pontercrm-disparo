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

    await db.insert(schema.whatsappInstances).values({
      id,
      provider: body.data.provider,
      externalId: id, // overridden when provider returns its own id
      number,
      status: "pending",
      rateLimitPerMinute: body.data.rateLimitPerMinute,
      configJson: encryptJson(body.data.configJson, config.ENCRYPTION_KEY),
      active: true
    });
    return reply.code(201).send({ id });
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

      if (row.provider !== "uazapi") {
        return reply.badRequest("refresh-status only supported for uazapi");
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
