import { schema } from "@pointer/db";
import { newId } from "@pointer/shared";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { generatePropertyPdf } from "../lib/property-pdf.js";
import { getStorage } from "../lib/storage.js";
import { saveMultipartFile } from "../lib/upload-helper.js";

const addressSchema = z
  .object({
    street: z.string().optional(),
    number: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional()
  })
  .partial()
  .strict();

const photoSchema = z.object({
  url: z.string().url(),
  caption: z.string().optional()
});

const propertyBody = z.object({
  code: z.string().max(40).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  kind: z.string().min(1).max(40),
  transactionType: z.enum(["sale", "rent"]),
  priceCents: z.number().int().nonnegative().nullable().optional(),
  condoFeeCents: z.number().int().nonnegative().nullable().optional(),
  iptuCents: z.number().int().nonnegative().nullable().optional(),
  bedrooms: z.number().int().nonnegative().nullable().optional(),
  bathrooms: z.number().int().nonnegative().nullable().optional(),
  parkingSpots: z.number().int().nonnegative().nullable().optional(),
  areaSqm: z.number().int().nonnegative().nullable().optional(),
  featuresJson: z.array(z.string()).optional(),
  addressJson: addressSchema.optional(),
  photosJson: z.array(photoSchema).optional(),
  externalRef: z.string().nullable().optional(),
  active: z.boolean().optional()
});

export async function registerProperties(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };
  const supervisorGuard = {
    preHandler: [app.authenticate, app.requireRole("admin", "supervisor")]
  };

  app.get<{
    Querystring: { search?: string; transactionType?: string; active?: string };
  }>("/properties", auth, async (req) => {
    const db = getDb();
    const where = [];
    if (req.query.search) {
      const pat = `%${req.query.search}%`;
      where.push(
        or(
          ilike(schema.properties.title, pat),
          ilike(schema.properties.description, pat),
          ilike(schema.properties.code, pat)
        )!
      );
    }
    if (req.query.transactionType === "sale" || req.query.transactionType === "rent") {
      where.push(eq(schema.properties.transactionType, req.query.transactionType));
    }
    if (req.query.active === "true" || req.query.active === "false") {
      where.push(eq(schema.properties.active, req.query.active === "true"));
    }

    const rows = await db.query.properties.findMany({
      where: where.length ? and(...where) : undefined,
      orderBy: [desc(schema.properties.createdAt)],
      limit: 100
    });
    return { properties: rows };
  });

  app.post("/properties", supervisorGuard, async (req, reply) => {
    const body = propertyBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();
    const id = newId();
    await db.insert(schema.properties).values({
      id,
      ...body.data,
      createdBy: req.user.sub
    });
    return reply.code(201).send({ id });
  });

  app.get<{ Params: { id: string } }>("/properties/:id", auth, async (req, reply) => {
    const db = getDb();
    const row = await db.query.properties.findFirst({
      where: eq(schema.properties.id, req.params.id)
    });
    if (!row) return reply.notFound();
    return { property: row };
  });

  app.patch<{ Params: { id: string } }>(
    "/properties/:id",
    supervisorGuard,
    async (req, reply) => {
      const body = propertyBody.partial().safeParse(req.body);
      if (!body.success) return reply.badRequest(body.error.message);
      const db = getDb();
      await db
        .update(schema.properties)
        .set(body.data)
        .where(eq(schema.properties.id, req.params.id));
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/properties/:id",
    supervisorGuard,
    async (req, reply) => {
      const db = getDb();
      await db.delete(schema.properties).where(eq(schema.properties.id, req.params.id));
      return reply.code(204).send();
    }
  );

  // ── PDF: ficha do imóvel sob demanda ─────────────────────────────────
  app.get<{ Params: { id: string } }>("/properties/:id/pdf", auth, async (req, reply) => {
    const db = getDb();
    const prop = await db.query.properties.findFirst({
      where: eq(schema.properties.id, req.params.id)
    });
    if (!prop) return reply.notFound();

    const buf = await generatePropertyPdf(prop);
    reply
      .header("content-type", "application/pdf")
      .header(
        "content-disposition",
        `inline; filename="${slugify(prop.title || prop.id)}.pdf"`
      )
      .send(buf);
  });

  // ── Photos: multipart upload (1 file per request) ────────────────────
  app.post<{ Params: { id: string } }>(
    "/properties/:id/photos",
    supervisorGuard,
    async (req, reply) => {
      const db = getDb();
      const prop = await db.query.properties.findFirst({
        where: eq(schema.properties.id, req.params.id)
      });
      if (!prop) return reply.notFound();

      const file = await req.file();
      if (!file) return reply.badRequest("missing file");
      if (!file.mimetype.startsWith("image/")) {
        return reply.badRequest("only images are allowed for property photos");
      }
      const caption =
        typeof file.fields.caption === "object" && "value" in file.fields.caption
          ? String((file.fields.caption as { value: unknown }).value ?? "")
          : "";

      const saved = await saveMultipartFile({
        file,
        entityType: "property",
        entityId: req.params.id
      });

      const next = [
        ...(prop.photosJson ?? []),
        { url: saved.stored.url, caption: caption || undefined }
      ];
      await db
        .update(schema.properties)
        .set({ photosJson: next })
        .where(eq(schema.properties.id, req.params.id));

      return reply.code(201).send({
        url: saved.stored.url,
        index: next.length - 1,
        total: next.length
      });
    }
  );

  app.delete<{ Params: { id: string; index: string } }>(
    "/properties/:id/photos/:index",
    supervisorGuard,
    async (req, reply) => {
      const db = getDb();
      const idx = parseInt(req.params.index, 10);
      if (Number.isNaN(idx) || idx < 0) return reply.badRequest("invalid index");

      const prop = await db.query.properties.findFirst({
        where: eq(schema.properties.id, req.params.id)
      });
      if (!prop) return reply.notFound();

      const photos = prop.photosJson ?? [];
      if (idx >= photos.length) return reply.badRequest("index out of bounds");

      const removed = photos[idx]!;
      const apiUrl = process.env.API_URL ?? "http://localhost:3333";
      const filesPrefix = `${apiUrl.replace(/\/$/, "")}/files/`;
      if (removed.url.startsWith(filesPrefix)) {
        const storagePath = removed.url.slice(filesPrefix.length);
        await getStorage().delete(storagePath).catch(() => void 0);
      }

      const next = photos.filter((_, i) => i !== idx);
      await db
        .update(schema.properties)
        .set({ photosJson: next })
        .where(eq(schema.properties.id, req.params.id));

      return { ok: true, total: next.length };
    }
  );
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase()
    .slice(0, 50);
}
