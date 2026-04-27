import { schema } from "@pointer/db";
import type { AppointmentStatus } from "@pointer/shared";
import { newId } from "@pointer/shared";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";

const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "done",
  "cancelled",
  "no_show"
] as const;

const createBody = z.object({
  conversationId: z.string().uuid(),
  leadId: z.string().uuid(),
  brokerId: z.string().uuid().nullable().optional(),
  scheduledFor: z.string().datetime(),
  address: z.string().optional(),
  notes: z.string().optional()
});

const patchBody = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  scheduledFor: z.string().datetime().optional(),
  brokerId: z.string().uuid().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});

async function brokerOf(req: { user: { sub: string; role: string } }, db: ReturnType<typeof getDb>) {
  if (req.user.role !== "broker") return null;
  const broker = await db.query.brokers.findFirst({
    where: eq(schema.brokers.userId, req.user.sub),
    columns: { id: true }
  });
  return broker?.id ?? null;
}

export async function registerAppointments(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get<{
    Querystring: {
      status?: string;
      brokerId?: string;
      from?: string;
      to?: string;
      leadId?: string;
    };
  }>("/appointments", auth, async (req, reply) => {
    const db = getDb();
    const where = [];

    if (req.query.status) {
      if (!APPOINTMENT_STATUSES.includes(req.query.status as AppointmentStatus)) {
        return reply.badRequest("invalid status");
      }
      where.push(eq(schema.appointments.status, req.query.status as AppointmentStatus));
    }
    if (req.query.leadId) where.push(eq(schema.appointments.leadId, req.query.leadId));
    if (req.query.from) where.push(gte(schema.appointments.scheduledFor, new Date(req.query.from)));
    if (req.query.to) where.push(lte(schema.appointments.scheduledFor, new Date(req.query.to)));

    // Brokers see only their own
    const ownBroker = await brokerOf(req, db);
    if (ownBroker) {
      where.push(eq(schema.appointments.brokerId, ownBroker));
    } else if (req.query.brokerId) {
      where.push(eq(schema.appointments.brokerId, req.query.brokerId));
    }

    const rows = await db.query.appointments.findMany({
      where: where.length ? and(...where) : undefined,
      orderBy: [asc(schema.appointments.scheduledFor)],
      limit: 200,
      with: {
        lead: { columns: { id: true, name: true, phone: true } },
        broker: { columns: { id: true, displayName: true } },
        conversation: { columns: { id: true, status: true } }
      }
    });

    return { appointments: rows };
  });

  app.get<{ Params: { id: string } }>("/appointments/:id", auth, async (req, reply) => {
    const db = getDb();
    const row = await db.query.appointments.findFirst({
      where: eq(schema.appointments.id, req.params.id),
      with: {
        lead: true,
        broker: { columns: { id: true, displayName: true } },
        conversation: { columns: { id: true, status: true, leadId: true } }
      }
    });
    if (!row) return reply.notFound();

    const ownBroker = await brokerOf(req, db);
    if (ownBroker && row.brokerId !== ownBroker) return reply.forbidden();

    return { appointment: row };
  });

  // POST /appointments — manual creation by broker / supervisor / admin
  app.post("/appointments", auth, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();

    // Sanity: conversation and lead must match
    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, body.data.conversationId),
      columns: { id: true, leadId: true, assignedBrokerId: true }
    });
    if (!conv) return reply.badRequest("conversation not found");
    if (conv.leadId !== body.data.leadId) {
      return reply.badRequest("leadId does not match conversation");
    }

    const ownBroker = await brokerOf(req, db);
    const targetBroker = body.data.brokerId !== undefined
      ? body.data.brokerId
      : (ownBroker ?? conv.assignedBrokerId ?? null);

    const id = newId();
    await db.insert(schema.appointments).values({
      id,
      conversationId: body.data.conversationId,
      leadId: body.data.leadId,
      brokerId: targetBroker ?? undefined,
      scheduledFor: new Date(body.data.scheduledFor),
      address: body.data.address,
      notes: body.data.notes,
      status: "scheduled",
      source: "manual"
    });
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>("/appointments/:id", auth, async (req, reply) => {
    const body = patchBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();

    const existing = await db.query.appointments.findFirst({
      where: eq(schema.appointments.id, req.params.id),
      columns: { id: true, brokerId: true }
    });
    if (!existing) return reply.notFound();

    const ownBroker = await brokerOf(req, db);
    if (ownBroker && existing.brokerId !== ownBroker) return reply.forbidden();

    const update: Record<string, unknown> = { ...body.data };
    if (body.data.scheduledFor) update.scheduledFor = new Date(body.data.scheduledFor);

    await db.update(schema.appointments).set(update).where(eq(schema.appointments.id, req.params.id));
    return { ok: true };
  });
}
