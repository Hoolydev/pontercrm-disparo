import { schema } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import type { CampaignLeadState, CampaignStatus } from "@pointer/shared";
import { newId, normalizeE164 } from "@pointer/shared";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import * as XLSX from "xlsx";
import { z } from "zod";
import { getDb } from "../db.js";
import { getStorage } from "../lib/storage.js";
import { saveMultipartFile } from "../lib/upload-helper.js";

const settingsSchema = z
  .object({
    delay_range_ms: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
    max_messages_per_minute: z.number().int().min(1).max(500).optional(),
    min_seconds_between_messages_per_lead: z.number().int().nonnegative().optional(),
    send_media: z.boolean().optional(),
    followup_enabled: z.boolean().optional(),
    business_hours: z
      .object({
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        tz: z.string().min(1)
      })
      .optional()
  })
  .strict();

const createBody = z.object({
  name: z.string().min(1).max(160),
  outboundAgentId: z.string().uuid().nullable().optional(),
  inboundAgentId: z.string().uuid().nullable().optional(),
  pipelineId: z.string().uuid().optional(),
  settingsJson: settingsSchema.optional(),
  firstMessageTemplate: z.string().max(2000).nullable().optional()
});

const patchBody = createBody.partial().extend({
  status: z.enum(["draft", "active", "paused", "archived"]).optional()
});

async function resolveDefaultPipelineId(db: ReturnType<typeof getDb>): Promise<string | null> {
  const row = await db.query.pipelines.findFirst({
    where: eq(schema.pipelines.isDefault, true),
    columns: { id: true }
  });
  return row?.id ?? null;
}

async function loadCampaign(db: ReturnType<typeof getDb>, id: string) {
  return db.query.campaigns.findFirst({
    where: eq(schema.campaigns.id, id),
    with: {
      outboundAgent: { columns: { id: true, name: true, model: true, type: true } },
      inboundAgent: { columns: { id: true, name: true, model: true, type: true } },
      pipeline: { columns: { id: true, name: true, isDefault: true } },
      instances: {
        with: { instance: { columns: { id: true, number: true, provider: true, status: true } } }
      }
    }
  });
}

async function transitionStatus(
  app: FastifyInstance,
  id: string,
  next: CampaignStatus,
  reply: FastifyReply
) {
  const db = getDb();
  const camp = await db.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) });
  if (!camp) return reply.notFound();

  if (next === "active") {
    if (!camp.outboundAgentId || !camp.inboundAgentId) {
      return reply.badRequest("campaign needs both outbound_agent_id and inbound_agent_id to start");
    }
    const instRows = await db
      .select({ n: count() })
      .from(schema.campaignInstances)
      .where(eq(schema.campaignInstances.campaignId, id));
    const instCount = Number(instRows[0]?.n ?? 0);
    if (instCount === 0) {
      return reply.badRequest("campaign needs at least one whatsapp instance attached");
    }
  }

  await db
    .update(schema.campaigns)
    .set({ status: next })
    .where(eq(schema.campaigns.id, id));

  app.log.info({ campaignId: id, status: next }, "campaign: status transition");

  // When transitioning into 'active' (start or resume), enqueue the seeder.
  // jobId scoped per minute prevents accidental double-seeds from rapid clicks.
  if (next === "active") {
    const minuteBucket = Math.floor(Date.now() / 60_000);
    await getQueues()
      .outboundBlastSeeder.add(
        `seed:${id}`,
        { campaignId: id },
        { jobId: `seed:${id}:${minuteBucket}` }
      )
      .catch((err) => {
        app.log.warn({ err, campaignId: id }, "campaign: seeder enqueue skipped (already exists)");
      });
  }

  return { ok: true, status: next };
}

export async function registerCampaigns(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole("admin")] };
  const supervisorGuard = {
    preHandler: [app.authenticate, app.requireRole("admin", "supervisor")]
  };
  const authGuard = { preHandler: [app.authenticate] };

  // ── List campaigns ───────────────────────────────────────────────────
  app.get<{ Querystring: { status?: string } }>("/campaigns", authGuard, async (req) => {
    const db = getDb();
    const where = req.query.status
      ? eq(schema.campaigns.status, req.query.status as CampaignStatus)
      : undefined;
    const rows = await db.query.campaigns.findMany({
      where,
      orderBy: [desc(schema.campaigns.createdAt)],
      with: {
        outboundAgent: { columns: { id: true, name: true } },
        inboundAgent: { columns: { id: true, name: true } },
        pipeline: { columns: { id: true, name: true } },
        // Lightweight: just the join row IDs. Used by the agent flow editor
        // to render which WhatsApp numbers are attached without a per-campaign
        // GET round-trip.
        instances: { columns: { instanceId: true } }
      }
    });
    return {
      campaigns: rows.map((r) => ({
        ...r,
        instanceIds: r.instances.map((i) => i.instanceId)
      }))
    };
  });

  // ── Create ──────────────────────────────────────────────────────────
  app.post("/campaigns", adminGuard, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();

    const pipelineId = body.data.pipelineId ?? (await resolveDefaultPipelineId(db));
    if (!pipelineId) {
      return reply.badRequest("no pipelineId given and no default pipeline found");
    }

    const id = newId();
    await db.insert(schema.campaigns).values({
      id,
      name: body.data.name,
      status: "draft",
      outboundAgentId: body.data.outboundAgentId ?? undefined,
      inboundAgentId: body.data.inboundAgentId ?? undefined,
      pipelineId,
      settingsJson: body.data.settingsJson ?? {},
      createdBy: req.user.sub
    });
    return reply.code(201).send({ id });
  });

  // ── Detail ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/campaigns/:id", authGuard, async (req, reply) => {
    const db = getDb();
    const camp = await loadCampaign(db, req.params.id);
    if (!camp) return reply.notFound();

    // Aggregate: counts of campaign_leads by state
    const stateRows = await db
      .select({
        state: schema.campaignLeads.state,
        n: count()
      })
      .from(schema.campaignLeads)
      .where(eq(schema.campaignLeads.campaignId, req.params.id))
      .groupBy(schema.campaignLeads.state);
    const leadCounts: Record<string, number> = {};
    for (const r of stateRows) leadCounts[r.state] = Number(r.n);

    return { campaign: camp, leadCounts };
  });

  // ── Update ──────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>("/campaigns/:id", adminGuard, async (req, reply) => {
    const body = patchBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();
    await db
      .update(schema.campaigns)
      .set(body.data)
      .where(eq(schema.campaigns.id, req.params.id));
    return { ok: true };
  });

  // ── Delete (only draft / archived) ──────────────────────────────────
  app.delete<{ Params: { id: string } }>("/campaigns/:id", adminGuard, async (req, reply) => {
    const db = getDb();
    const camp = await db.query.campaigns.findFirst({
      where: eq(schema.campaigns.id, req.params.id),
      columns: { id: true, status: true }
    });
    if (!camp) return reply.notFound();
    if (camp.status === "active" || camp.status === "paused") {
      return reply.badRequest(`cannot delete a campaign in status=${camp.status} — archive first`);
    }
    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, req.params.id));
    return reply.code(204).send();
  });

  // ── Lifecycle ───────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/campaigns/:id/start", supervisorGuard, async (req, reply) =>
    transitionStatus(app, req.params.id, "active", reply)
  );
  app.post<{ Params: { id: string } }>("/campaigns/:id/pause", supervisorGuard, async (req, reply) =>
    transitionStatus(app, req.params.id, "paused", reply)
  );
  app.post<{ Params: { id: string } }>("/campaigns/:id/resume", supervisorGuard, async (req, reply) =>
    transitionStatus(app, req.params.id, "active", reply)
  );
  app.post<{ Params: { id: string } }>("/campaigns/:id/archive", adminGuard, async (req, reply) =>
    transitionStatus(app, req.params.id, "archived", reply)
  );

  // ── Instance attach / detach ────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/campaigns/:id/instances",
    adminGuard,
    async (req, reply) => {
      const body = z.object({ instanceId: z.string().uuid() }).safeParse(req.body);
      if (!body.success) return reply.badRequest();
      const db = getDb();
      // Idempotent: ON CONFLICT DO NOTHING avoids the 500 Postgres returns when
      // the user re-clicks an already-attached instance.
      const result = await db
        .insert(schema.campaignInstances)
        .values({
          campaignId: req.params.id,
          instanceId: body.data.instanceId
        })
        .onConflictDoNothing({
          target: [
            schema.campaignInstances.campaignId,
            schema.campaignInstances.instanceId
          ]
        })
        .returning({ campaignId: schema.campaignInstances.campaignId });
      const alreadyAttached = result.length === 0;
      return reply.code(alreadyAttached ? 200 : 201).send({ ok: true, alreadyAttached });
    }
  );

  app.delete<{ Params: { id: string; instanceId: string } }>(
    "/campaigns/:id/instances/:instanceId",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      await db
        .delete(schema.campaignInstances)
        .where(
          and(
            eq(schema.campaignInstances.campaignId, req.params.id),
            eq(schema.campaignInstances.instanceId, req.params.instanceId)
          )
        );
      return reply.code(204).send();
    }
  );

  // ── Campaign leads (the dispatch list) ──────────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { state?: string; page?: string };
  }>("/campaigns/:id/leads", authGuard, async (req) => {
    const db = getDb();
    const limit = 50;
    const offset = (parseInt(req.query.page ?? "1", 10) - 1) * limit;

    const where = [eq(schema.campaignLeads.campaignId, req.params.id)];
    if (req.query.state) {
      where.push(eq(schema.campaignLeads.state, req.query.state as CampaignLeadState));
    }

    const rows = await db.query.campaignLeads.findMany({
      where: and(...where),
      orderBy: [asc(schema.campaignLeads.createdAt)],
      limit,
      offset,
      with: {
        lead: {
          columns: { id: true, name: true, phone: true, email: true, pipelineStageId: true }
        }
      }
    });
    return { leads: rows, page: parseInt(req.query.page ?? "1", 10), limit };
  });

  app.post<{ Params: { id: string } }>(
    "/campaigns/:id/leads",
    supervisorGuard,
    async (req, reply) => {
      const body = z
        .object({ leadIds: z.array(z.string().uuid()).min(1).max(2000) })
        .safeParse(req.body);
      if (!body.success) return reply.badRequest(body.error.message);
      const db = getDb();

      const camp = await db.query.campaigns.findFirst({
        where: eq(schema.campaigns.id, req.params.id),
        columns: { id: true, status: true }
      });
      if (!camp) return reply.notFound();

      // Insert in chunks; ignore conflicts (UNIQUE on campaign_id, lead_id).
      const rows = body.data.leadIds.map((leadId) => ({
        id: newId(),
        campaignId: req.params.id,
        leadId,
        state: "pending" as const
      }));

      let inserted = 0;
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const result = await db
          .insert(schema.campaignLeads)
          .values(slice)
          .onConflictDoNothing({ target: [schema.campaignLeads.campaignId, schema.campaignLeads.leadId] })
          .returning({ id: schema.campaignLeads.id });
        inserted += result.length;
      }

      return reply.code(201).send({
        requested: body.data.leadIds.length,
        inserted,
        skipped: body.data.leadIds.length - inserted
      });
    }
  );

  app.delete<{ Params: { id: string; leadId: string } }>(
    "/campaigns/:id/leads/:leadId",
    supervisorGuard,
    async (req, reply) => {
      const db = getDb();
      await db
        .delete(schema.campaignLeads)
        .where(
          and(
            eq(schema.campaignLeads.campaignId, req.params.id),
            eq(schema.campaignLeads.leadId, req.params.leadId)
          )
        );
      return reply.code(204).send();
    }
  );

  // ── Spreadsheet import: upload a CSV / XLSX / XLS, link leads to campaign
  app.post<{ Params: { id: string } }>(
    "/campaigns/:id/leads/import-csv",
    supervisorGuard,
    async (req, reply) => {
      const db = getDb();
      const campaignId = req.params.id;
      const exists = await db.query.campaigns.findFirst({
        where: eq(schema.campaigns.id, campaignId),
        columns: { id: true }
      });
      if (!exists) return reply.notFound();

      const file = await req.file();
      if (!file) return reply.badRequest("missing file");

      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const c of file.file) {
        chunks.push(c);
        bytes += c.length;
        if (bytes > 10_000_000)
          return reply.badRequest("planilha muito grande (>10MB)");
      }
      const buffer = Buffer.concat(chunks);

      let parsed: CsvRow[];
      try {
        parsed = parseSpreadsheet(buffer, file.filename, file.mimetype);
      } catch (err) {
        return reply.badRequest(
          `erro ao ler planilha: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (parsed.length === 0) return reply.badRequest("planilha vazia");

      // Source: ensure a global "CSV Import" lead source exists.
      let source = await db.query.leadSources.findFirst({
        where: eq(schema.leadSources.name, "CSV Import"),
        columns: { id: true }
      });
      if (!source) {
        const sourceId = newId();
        await db.insert(schema.leadSources).values({
          id: sourceId,
          type: "manual",
          name: "CSV Import",
          // CSV source doesn't receive webhooks; placeholder secret to satisfy NOT NULL.
          webhookSecret: `csv-import-${newId()}`,
          active: true,
          configJson: {}
        });
        source = { id: sourceId };
      }

      // Pick the first stage of the campaign's pipeline (smallest position).
      // Falls back to any first stage if the campaign isn't tied to a specific
      // pipeline (legacy data) or pipeline has no stages.
      const camp = await db.query.campaigns.findFirst({
        where: eq(schema.campaigns.id, campaignId),
        columns: { pipelineId: true }
      });
      const stage = camp?.pipelineId
        ? await db.query.pipelineStages.findFirst({
            where: eq(schema.pipelineStages.pipelineId, camp.pipelineId),
            orderBy: [asc(schema.pipelineStages.position)],
            columns: { id: true }
          })
        : await db.query.pipelineStages.findFirst({
            orderBy: [asc(schema.pipelineStages.position)],
            columns: { id: true }
          });
      if (!stage)
        return reply.badRequest(
          "nenhum stage de pipeline configurado — crie pelo menos um stage em /app/pipelines"
        );

      // ── Bulk upsert leads + link to campaign ─────────────────────────
      // For 4000+ row spreadsheets a per-row SELECT+INSERT loop becomes ~9000
      // round-trips and times out the HTTP request. Strategy here:
      //   1) Normalize all phones in-memory; collect errors
      //   2) Single SELECT for existing leads (inArray)
      //   3) Bulk INSERT for new leads (chunked, onConflictDoNothing in case
      //      of race with another import)
      //   4) Re-SELECT to map all phones → leadId
      //   5) Bulk INSERT campaign_leads
      const errors: Array<{ row: number; reason: string }> = [];
      const phoneToRow = new Map<string, CsvRow>(); // phone → first occurrence

      for (let i = 0; i < parsed.length; i++) {
        const r = parsed[i]!;
        if (!r.phone) {
          errors.push({ row: i + 1, reason: "telefone vazio" });
          continue;
        }
        let phone: string;
        try {
          phone = normalizeE164(r.phone);
        } catch {
          errors.push({ row: i + 1, reason: `telefone inválido: ${r.phone}` });
          continue;
        }
        if (!phoneToRow.has(phone)) {
          phoneToRow.set(phone, { ...r, phone });
        }
      }

      const allPhones = Array.from(phoneToRow.keys());
      if (allPhones.length === 0) {
        return reply.badRequest(
          `nenhum telefone válido encontrado (${errors.length} linhas com erro)`
        );
      }

      // 2. Find which phones already exist for this source.
      const existingChunks: { id: string; phone: string }[] = [];
      const SELECT_CHUNK = 1000;
      for (let i = 0; i < allPhones.length; i += SELECT_CHUNK) {
        const slice = allPhones.slice(i, i + SELECT_CHUNK);
        const found = await db
          .select({ id: schema.leads.id, phone: schema.leads.phone })
          .from(schema.leads)
          .where(
            and(
              eq(schema.leads.sourceId, source.id),
              inArray(schema.leads.phone, slice)
            )
          );
        existingChunks.push(...found);
      }
      const existingByPhone = new Map(existingChunks.map((r) => [r.phone, r.id]));

      // 3. Bulk INSERT new leads.
      const toInsert = allPhones
        .filter((p) => !existingByPhone.has(p))
        .map((p) => {
          const r = phoneToRow.get(p)!;
          return {
            id: newId(),
            sourceId: source.id,
            phone: p,
            name: r.name ?? undefined,
            email: r.email ?? undefined,
            propertyRef: r.property_ref ?? undefined,
            origin: r.origin ?? "csv",
            metadataJson: { importedAt: new Date().toISOString() },
            pipelineStageId: stage.id
          };
        });

      const INSERT_CHUNK = 500;
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const slice = toInsert.slice(i, i + INSERT_CHUNK);
        await db
          .insert(schema.leads)
          .values(slice)
          .onConflictDoNothing({
            target: [schema.leads.sourceId, schema.leads.externalId]
          });
        // Track the IDs we just inserted (or thought we did — race path).
        for (const v of slice) existingByPhone.set(v.phone, v.id);
      }

      // 4. If race lost any inserts (onConflictDoNothing didn't return rows),
      // re-fetch to make sure every phone is mapped.
      if (toInsert.length > 0) {
        const reFetchPhones = toInsert
          .map((v) => v.phone)
          .filter((p) => !existingByPhone.has(p));
        if (reFetchPhones.length > 0) {
          for (let i = 0; i < reFetchPhones.length; i += SELECT_CHUNK) {
            const slice = reFetchPhones.slice(i, i + SELECT_CHUNK);
            const found = await db
              .select({ id: schema.leads.id, phone: schema.leads.phone })
              .from(schema.leads)
              .where(
                and(
                  eq(schema.leads.sourceId, source.id),
                  inArray(schema.leads.phone, slice)
                )
              );
            for (const f of found) existingByPhone.set(f.phone, f.id);
          }
        }
      }

      const leadIds = allPhones
        .map((p) => existingByPhone.get(p))
        .filter((x): x is string => Boolean(x));

      // 5. Bulk INSERT campaign_leads (idempotent via UNIQUE on
      // (campaign_id, lead_id)).
      let inserted = 0;
      const LINK_CHUNK = 500;
      for (let i = 0; i < leadIds.length; i += LINK_CHUNK) {
        const slice = leadIds.slice(i, i + LINK_CHUNK).map((leadId) => ({
          id: newId(),
          campaignId,
          leadId,
          state: "pending" as const
        }));
        const result = await db
          .insert(schema.campaignLeads)
          .values(slice)
          .onConflictDoNothing({
            target: [schema.campaignLeads.campaignId, schema.campaignLeads.leadId]
          })
          .returning({ id: schema.campaignLeads.id });
        inserted += result.length;
      }

      req.log.info(
        {
          campaignId,
          rows: parsed.length,
          uniquePhones: allPhones.length,
          newLeads: toInsert.length,
          attached: inserted,
          errors: errors.length
        },
        "csv-import: done"
      );

      return reply.code(201).send({
        rows: parsed.length,
        leadsCreated: toInsert.length,
        attached: inserted,
        skipped: leadIds.length - inserted,
        errors: errors.slice(0, 50)
      });
    }
  );

  // ── Campaign attachments ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/campaigns/:id/attachments",
    authGuard,
    async (req) => {
      const db = getDb();
      const rows = await db.query.campaignAttachments.findMany({
        where: eq(schema.campaignAttachments.campaignId, req.params.id),
        orderBy: [desc(schema.campaignAttachments.createdAt)]
      });
      return { attachments: rows };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/campaigns/:id/attachments",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const exists = await db.query.campaigns.findFirst({
        where: eq(schema.campaigns.id, req.params.id),
        columns: { id: true }
      });
      if (!exists) return reply.notFound();

      const file = await req.file();
      if (!file) return reply.badRequest("missing file");

      const caption =
        typeof file.fields.caption === "object" && "value" in file.fields.caption
          ? String((file.fields.caption as { value: unknown }).value ?? "")
          : null;

      let saved;
      try {
        saved = await saveMultipartFile({
          file,
          entityType: "campaign",
          entityId: req.params.id
        });
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }

      const id = newId();
      await db.insert(schema.campaignAttachments).values({
        id,
        campaignId: req.params.id,
        kind: saved.kind,
        filename: saved.stored.filename,
        mimeType: saved.stored.mimeType,
        sizeBytes: saved.stored.size,
        storagePath: saved.stored.storagePath,
        url: saved.stored.url,
        caption: caption || null
      });

      return reply.code(201).send({
        id,
        kind: saved.kind,
        url: saved.stored.url,
        filename: saved.stored.filename,
        sizeBytes: saved.stored.size
      });
    }
  );

  app.delete<{ Params: { id: string; attId: string } }>(
    "/campaigns/:id/attachments/:attId",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const row = await db.query.campaignAttachments.findFirst({
        where: and(
          eq(schema.campaignAttachments.id, req.params.attId),
          eq(schema.campaignAttachments.campaignId, req.params.id)
        )
      });
      if (!row) return reply.notFound();
      await getStorage().delete(row.storagePath).catch(() => void 0);
      await db
        .delete(schema.campaignAttachments)
        .where(eq(schema.campaignAttachments.id, req.params.attId));
      return reply.code(204).send();
    }
  );

  // ── Quick stats endpoint (used by dashboard) ────────────────────────
  app.get<{ Params: { id: string } }>("/campaigns/:id/stats", authGuard, async (req, reply) => {
    const db = getDb();
    const camp = await db.query.campaigns.findFirst({
      where: eq(schema.campaigns.id, req.params.id),
      columns: { id: true }
    });
    if (!camp) return reply.notFound();

    const [stateRows, convRows] = await Promise.all([
      db
        .select({ state: schema.campaignLeads.state, n: count() })
        .from(schema.campaignLeads)
        .where(eq(schema.campaignLeads.campaignId, req.params.id))
        .groupBy(schema.campaignLeads.state),
      db
        .select({ totalConvs: sql<number>`count(*)::int` })
        .from(schema.conversations)
        .where(eq(schema.conversations.campaignId, req.params.id))
    ]);

    return {
      campaignLeads: Object.fromEntries(stateRows.map((r) => [r.state, Number(r.n)])),
      conversations: Number(convRows[0]?.totalConvs ?? 0)
    };
  });
}

type CsvRow = {
  phone?: string;
  name?: string;
  email?: string;
  property_ref?: string;
  origin?: string;
};

/**
 * Header aliases — matched after lowercasing and stripping accents/spaces.
 * Covers: PT-BR, EN, and the Superlogica/CRM-style export ("Telefone",
 * "Nome", "TodosEmails" etc) the client uses.
 */
const HEADER_ALIASES: Record<string, keyof CsvRow> = {
  // phone
  phone: "phone",
  telefone: "phone",
  telefone1: "phone",
  telefone2: "phone",
  celular: "phone",
  whatsapp: "phone",
  numero: "phone",
  fone: "phone",
  // name
  nome: "name",
  name: "name",
  cliente: "name",
  // email
  email: "email",
  email1: "email",
  email2: "email",
  emails: "email",
  todosemails: "email",
  // property
  property: "property_ref",
  propertyref: "property_ref",
  imovel: "property_ref",
  ref: "property_ref",
  codigo: "property_ref",
  codigoauxliar: "property_ref",
  codigoauxiliar: "property_ref",
  // origin
  origem: "origin",
  origin: "origin",
  classificacao: "origin",
  etiquetas: "origin"
};

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s\-_]/g, "")
    .replace(/^"|"$/g, "")
    .trim();
}

/**
 * Detect format and parse. Auto-detects:
 *   - CSV (text, ',' or ';' delimiter)
 *   - XLSX (Office Open XML, ZIP)
 *   - XLS (BIFF binary)
 *   - HTML disguised as .xls (common from Brazilian CRMs that export
 *     <table> markup with .xls extension — Superlogica, etc.)
 *
 * Detection order matters: HTML must be checked before filename-matching
 * because Superlogica writes `.xls` even though the bytes are `<div>...`.
 * SheetJS needs a string for HTML mode and a buffer for binary modes.
 */
function parseSpreadsheet(buffer: Buffer, _filename: string, mime: string): CsvRow[] {
  const head = buffer.slice(0, 32).toString("ascii").toLowerCase().trim();
  const looksHtml =
    head.startsWith("<") ||
    head.startsWith("﻿<") ||
    mime.includes("html");
  const looksZip = buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK" — XLSX/ZIP
  const looksOleCfb =
    buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0; // BIFF .xls

  let rows: Record<string, unknown>[];

  if (looksHtml) {
    // HTML <table> mode — pass a string to SheetJS.
    const wb = XLSX.read(buffer.toString("utf8"), { type: "string" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]!, {
      defval: ""
    });
  } else if (looksZip || looksOleCfb) {
    // True binary XLSX or XLS.
    const wb = XLSX.read(buffer, { type: "buffer", raw: false });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]!, {
      defval: ""
    });
  } else {
    // Plain CSV
    return parseCsv(buffer.toString("utf8"));
  }

  return rows.map((raw) => {
    const out: CsvRow = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = HEADER_ALIASES[normalizeHeader(k)];
      if (!key) continue;
      const val = String(v ?? "").trim();
      if (!val) continue;
      // Don't overwrite already-set fields (so "Telefone" wins over "Telefone2")
      if (out[key]) continue;
      out[key] = val;
    }
    return out;
  });
}

/**
 * Lightweight CSV parser used as the fallback path. Supports `,` or `;`
 * delimiter (auto-detected), quoted fields, and the same header aliases.
 */
function parseCsv(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delim = lines[0]!.includes(";") ? ";" : ",";

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const firstRow = splitLine(lines[0]!).map((s) => normalizeHeader(s));
  const recognized = firstRow.some((c) => HEADER_ALIASES[c]);

  let headers: Array<keyof CsvRow | null>;
  let dataStart: number;
  if (recognized) {
    headers = firstRow.map((c) => HEADER_ALIASES[c] ?? null);
    dataStart = 1;
  } else {
    headers = ["phone", "name"];
    dataStart = 0;
  }

  const rows: CsvRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cols = splitLine(lines[i]!);
    const row: CsvRow = {};
    for (let j = 0; j < cols.length && j < headers.length; j++) {
      const key = headers[j];
      const val = cols[j]?.replace(/^"|"$/g, "").trim();
      if (key && val && !row[key]) row[key] = val;
    }
    rows.push(row);
  }
  return rows;
}
