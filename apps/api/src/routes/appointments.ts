import { schema } from "@pointer/db";
import type { AppointmentStatus } from "@pointer/shared";
import { newId } from "@pointer/shared";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";

const APPT_CONFLICT_WINDOW_MIN = 30;
const ACTIVE_APPT_STATUSES: AppointmentStatus[] = ["scheduled", "confirmed"];

async function findConflictingAppointment(
  db: ReturnType<typeof getDb>,
  brokerId: string,
  scheduledFor: Date,
  ignoreId: string | null
) {
  const winMs = APPT_CONFLICT_WINDOW_MIN * 60 * 1000;
  const from = new Date(scheduledFor.getTime() - winMs);
  const to = new Date(scheduledFor.getTime() + winMs);
  const where = [
    eq(schema.appointments.brokerId, brokerId),
    inArray(schema.appointments.status, ACTIVE_APPT_STATUSES),
    gte(schema.appointments.scheduledFor, from),
    lte(schema.appointments.scheduledFor, to)
  ];
  if (ignoreId) where.push(ne(schema.appointments.id, ignoreId));
  return db.query.appointments.findFirst({
    where: and(...where),
    columns: { id: true, scheduledFor: true, status: true }
  });
}

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

    const scheduledFor = new Date(body.data.scheduledFor);

    if (targetBroker) {
      const clash = await findConflictingAppointment(db, targetBroker, scheduledFor, null);
      if (clash) {
        return reply.code(409).send({
          message: "Broker já tem compromisso na janela de ±30min",
          conflictWith: clash
        });
      }
    }

    const id = newId();
    await db.insert(schema.appointments).values({
      id,
      conversationId: body.data.conversationId,
      leadId: body.data.leadId,
      brokerId: targetBroker ?? undefined,
      scheduledFor,
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
      columns: { id: true, brokerId: true, scheduledFor: true, status: true }
    });
    if (!existing) return reply.notFound();

    const ownBroker = await brokerOf(req, db);
    if (ownBroker && existing.brokerId !== ownBroker) return reply.forbidden();

    const update: Record<string, unknown> = { ...body.data };
    if (body.data.scheduledFor) update.scheduledFor = new Date(body.data.scheduledFor);

    // Re-check conflict if reschedule, broker change, or reactivation lands
    // the appointment in an active status with a broker.
    const nextBrokerId =
      body.data.brokerId !== undefined ? body.data.brokerId : existing.brokerId;
    const nextScheduledFor = body.data.scheduledFor
      ? new Date(body.data.scheduledFor)
      : existing.scheduledFor;
    const nextStatus = body.data.status ?? existing.status;
    const willBeActive = ACTIVE_APPT_STATUSES.includes(nextStatus);

    if (
      willBeActive &&
      nextBrokerId &&
      (body.data.scheduledFor !== undefined ||
        body.data.brokerId !== undefined ||
        body.data.status !== undefined)
    ) {
      const clash = await findConflictingAppointment(
        db,
        nextBrokerId,
        nextScheduledFor,
        existing.id
      );
      if (clash) {
        return reply.code(409).send({
          message: "Broker já tem compromisso na janela de ±30min",
          conflictWith: clash
        });
      }
    }

    await db.update(schema.appointments).set(update).where(eq(schema.appointments.id, req.params.id));
    return { ok: true };
  });
}
