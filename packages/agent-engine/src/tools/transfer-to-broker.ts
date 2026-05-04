import { schema } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { eq } from "drizzle-orm";
import { transitionConversationStatus } from "../lib/conversations.js";
import { createBrokerFollowups } from "../lib/followups.js";
import { pickBrokerForLead, recordBrokerAssignment } from "../lib/distribution.js";
import type { ToolEntry } from "../types.js";

const CH_INBOX = "inbox:updates";

export const transferToBroker: ToolEntry = {
  definition: {
    name: "transfer_to_broker",
    description:
      "Transfere a conversa para um corretor humano quando o lead demonstra intenção clara de visitar o imóvel, fazer proposta ou precisa de atendimento especializado fora do que a IA pode resolver.",
    parameters: {
      type: "object",
      properties: {
        broker_id: {
          type: "string",
          description:
            "UUID do corretor específico. Se omitido, o sistema escolhe pelo algoritmo de distribuição (menor carga + maior tempo sem lead)."
        },
        reason: {
          type: "string",
          description: "Motivo curto do handoff (ex: 'intenção de visita', 'pedido de proposta')."
        },
        urgency: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Nível de urgência da notificação ao corretor."
        },
        priority_hint: {
          type: "string",
          enum: ["low", "normal", "high"],
          description:
            "Sinalização de prioridade do lead pra distribuição. NÃO escolhe corretor — apenas anota no broker_queue."
        }
      },
      required: ["reason"]
    }
  },
  handler: async (ctx) => {
    const { conversationId, args, db, publisher, logger } = ctx;
    const reason = String(args.reason ?? "tool_call");
    const requestedBrokerId =
      typeof args.broker_id === "string" && args.broker_id.length > 0 ? args.broker_id : null;
    const urgency = args.urgency === "low" || args.urgency === "high" ? args.urgency : "normal";
    const priorityHint =
      typeof args.priority_hint === "string" ? args.priority_hint : null;

    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId)
    });
    if (!conv) return { status: "error", error: "conversation_not_found" };

    if (conv.aiPaused) {
      return { status: "duplicate", result: { reason: "already_paused" } };
    }

    // Resolve target broker: explicit > already-assigned > distribution algo
    let targetBroker: string | null =
      requestedBrokerId ?? conv.assignedBrokerId ?? null;
    if (!targetBroker) {
      targetBroker = await pickBrokerForLead(db);
    }

    await transitionConversationStatus(db, conversationId, "handed_off", {
      handoffReason: reason,
      assignBrokerId: targetBroker ?? null
    });

    if (targetBroker) {
      await db
        .update(schema.leads)
        .set({ assignedBrokerId: targetBroker })
        .where(eq(schema.leads.id, conv.leadId));

      // Record into broker_queue (timeout 15min) + create cobrança follow-ups.
      await recordBrokerAssignment(db, {
        leadId: conv.leadId,
        brokerId: targetBroker,
        conversationId,
        priorityHint,
        reason
      });
      await createBrokerFollowups(db, {
        leadId: conv.leadId,
        conversationId,
        campaignId: conv.campaignId ?? null,
        brokerId: targetBroker,
        triggerEvent: `transfer_to_broker:${reason}`
      });
    }

    await getQueues().brokerNotify.add(`handoff:${conversationId}`, {
      brokerId: targetBroker ?? "unassigned",
      conversationId,
      kind: "handoff",
      message: `[${urgency}] ${reason}`
    });

    await publisher.publish(
      CH_INBOX,
      JSON.stringify({
        kind: "handoff",
        conversationId,
        brokerId: targetBroker,
        reason,
        urgency,
        priorityHint
      })
    );

    logger.info(
      { conversationId, brokerId: targetBroker, reason, urgency, priorityHint },
      "tool: transfer_to_broker executed"
    );

    return {
      status: "ok",
      pausesAi: true,
      result: { brokerId: targetBroker, reason, urgency, priorityHint }
    };
  }
};
