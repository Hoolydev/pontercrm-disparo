import { schema } from "@pointer/db";
import { and, eq, ilike } from "drizzle-orm";
import { cancelPendingFollowupsForLead } from "../lib/followups.js";
import { changeLeadStage } from "../lib/leads.js";
import type { ToolEntry } from "../types.js";

const CH_INBOX = "inbox:updates";

export const updateStage: ToolEntry = {
  definition: {
    name: "update_stage",
    description:
      "Move o lead para outro estágio do funil de vendas (ex: qualificado, agendado). Use stage_id ou stage_name (resolve dentro da pipeline da campanha).",
    parameters: {
      type: "object",
      properties: {
        stage_id: {
          type: "string",
          description: "UUID exato do pipeline_stage."
        },
        stage_name: {
          type: "string",
          description: "Nome do estágio (resolvido contra a pipeline da campanha)."
        }
      },
      required: []
    }
  },
  handler: async (ctx) => {
    const { conversationId, args, db, publisher, logger } = ctx;

    const stageId =
      typeof args.stage_id === "string" && args.stage_id.length > 0 ? args.stage_id : null;
    const stageName =
      typeof args.stage_name === "string" && args.stage_name.length > 0
        ? args.stage_name
        : null;

    if (!stageId && !stageName) {
      return { status: "error", error: "stage_id or stage_name required" };
    }

    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
      with: { lead: true, campaign: true }
    });
    if (!conv) return { status: "error", error: "conversation_not_found" };

    // Resolve target pipeline:
    //   1. If conversation has a campaign → use campaign.pipeline_id (authoritative)
    //   2. Else → fall back to the pipeline of the lead's current stage
    let pipelineId: string;
    if (conv.campaign?.pipelineId) {
      pipelineId = conv.campaign.pipelineId;
    } else {
      const currentStage = await db.query.pipelineStages.findFirst({
        where: eq(schema.pipelineStages.id, conv.lead.pipelineStageId)
      });
      if (!currentStage) {
        return { status: "error", error: "no_pipeline_resolvable" };
      }
      pipelineId = currentStage.pipelineId;
    }

    // Look up stage scoped to the resolved pipeline.
    const stage = stageId
      ? await db.query.pipelineStages.findFirst({
          where: and(
            eq(schema.pipelineStages.id, stageId),
            eq(schema.pipelineStages.pipelineId, pipelineId)
          )
        })
      : await db.query.pipelineStages.findFirst({
          where: and(
            eq(schema.pipelineStages.pipelineId, pipelineId),
            ilike(schema.pipelineStages.name, stageName!)
          )
        });

    if (!stage) {
      return {
        status: "error",
        error: `stage ${stageId ?? stageName} not found in pipeline ${pipelineId}`
      };
    }

    const { changed, previousStageId } = await changeLeadStage(db, conv.leadId, stage.id);
    if (!changed) {
      logger.info(
        { conversationId, leadId: conv.leadId, stageId: stage.id },
        "tool: update_stage no-op (already at stage)"
      );
      return {
        status: "ok",
        result: { stageId: stage.id, stageName: stage.name, category: stage.category, unchanged: true }
      };
    }

    // If we just landed in a final category, kill any pending cobrança chain.
    if (stage.category === "won" || stage.category === "lost") {
      await cancelPendingFollowupsForLead(
        db,
        conv.leadId,
        `stage_moved_to_${stage.category}`
      );
    }

    await publisher.publish(
      CH_INBOX,
      JSON.stringify({
        kind: "lead:stage_changed",
        conversationId,
        leadId: conv.leadId,
        stageId: stage.id,
        stageName: stage.name,
        stageCategory: stage.category,
        previousStageId
      })
    );

    logger.info(
      {
        conversationId,
        leadId: conv.leadId,
        stageId: stage.id,
        stageName: stage.name
      },
      "tool: update_stage done"
    );

    return {
      status: "ok",
      pausesAi: false,
      result: {
        stageId: stage.id,
        stageName: stage.name,
        category: stage.category,
        previousStageId
      }
    };
  }
};
