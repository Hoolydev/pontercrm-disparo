import { schema } from "@pointer/db";
import { newId } from "@pointer/shared";
import { eq } from "drizzle-orm";
import { transferToBroker } from "./transfer-to-broker.js";
import type { ToolEntry } from "../types.js";

const CH_INBOX = "inbox:updates";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * MVP timezone policy: parse `date + time` as UTC. Real-world use will
 * eventually pin a campaign-level timezone (`settings.business_hours.tz`)
 * and convert from that — out of scope for Phase C.
 */
function parseSchedule(date: string, time: string): Date | null {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const d = new Date(`${date}T${time}:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const scheduleVisit: ToolEntry = {
  definition: {
    name: "schedule_visit",
    description:
      "Agenda uma visita do lead a um imóvel em data e horário específicos. Dispara handoff automático para um corretor humano.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          format: "date",
          description: "Data da visita no formato YYYY-MM-DD."
        },
        time: {
          type: "string",
          pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
          description: "Horário da visita no formato HH:MM (24h)."
        },
        address: {
          type: "string",
          description: "Endereço do imóvel a ser visitado, se confirmado."
        },
        notes: {
          type: "string",
          description: "Observações relevantes (preferências, restrições, etc)."
        }
      },
      required: ["date", "time"]
    }
  },
  handler: async (ctx) => {
    const { conversationId, args, db, publisher, logger } = ctx;

    const date = typeof args.date === "string" ? args.date : "";
    const time = typeof args.time === "string" ? args.time : "";
    const address = typeof args.address === "string" && args.address.length > 0 ? args.address : null;
    const notes = typeof args.notes === "string" && args.notes.length > 0 ? args.notes : null;

    const scheduledFor = parseSchedule(date, time);
    if (!scheduledFor) {
      return {
        status: "error",
        error: `invalid date/time: "${date}" "${time}" (expected YYYY-MM-DD HH:MM)`
      };
    }

    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId)
    });
    if (!conv) return { status: "error", error: "conversation_not_found" };

    const appointmentId = newId();
    await db.insert(schema.appointments).values({
      id: appointmentId,
      conversationId,
      leadId: conv.leadId,
      brokerId: conv.assignedBrokerId ?? undefined,
      scheduledFor,
      address: address ?? undefined,
      notes: notes ?? undefined,
      status: "scheduled",
      source: "ai_tool"
    });

    // Cascade: a scheduled visit implies the broker takes the conversation over.
    // We invoke transfer_to_broker's handler directly (no separate tool_executions
    // row — this is an internal effect of schedule_visit).
    const handoffReason = `Visita agendada para ${date} ${time}${address ? ` — ${address}` : ""}`;
    const cascade = await transferToBroker.handler({
      ...ctx,
      args: { reason: handoffReason, urgency: "high" }
    });

    await publisher.publish(
      CH_INBOX,
      JSON.stringify({
        kind: "appointment:created",
        conversationId,
        leadId: conv.leadId,
        brokerId: conv.assignedBrokerId,
        appointmentId,
        scheduledFor: scheduledFor.toISOString(),
        address,
        notes
      })
    );

    logger.info(
      {
        conversationId,
        appointmentId,
        scheduledFor: scheduledFor.toISOString(),
        cascade: cascade.status
      },
      "tool: schedule_visit done"
    );

    return {
      status: "ok",
      pausesAi: cascade.pausesAi ?? true,
      result: {
        appointmentId,
        scheduledFor: scheduledFor.toISOString(),
        address,
        notes,
        handoff: cascade.status
      }
    };
  }
};
