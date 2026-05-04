import { previewAgent } from "./preview.js";
import { runAgent } from "./run.js";
import type {
  AgentEngine,
  AgentEngineDeps,
  PreviewInput,
  PreviewResult,
  RunAgentInput,
  RunAgentResult
} from "./types.js";

export function createAgentEngine(deps: AgentEngineDeps): AgentEngine {
  return {
    run(input: RunAgentInput): Promise<RunAgentResult> {
      return runAgent(deps, input);
    },
    preview(input: PreviewInput): Promise<PreviewResult> {
      return previewAgent(deps, input);
    }
  };
}

export { builtInTools, resolveToolName, TOOL_NAME_ALIASES } from "./tools/index.js";
export {
  createBrokerFollowups,
  cancelPendingFollowups,
  cancelPendingFollowupsForBroker,
  cancelPendingFollowupsForLead,
  isLeadInFinalStage,
  markFollowupsSent
} from "./lib/followups.js";
export {
  pickBrokerForLead,
  recordBrokerAssignment,
  markBrokerAccepted,
  timeoutMsForPriority
} from "./lib/distribution.js";
export type { PriorityHint } from "./lib/distribution.js";
export {
  applyScoreSignal,
  applyMessageSignals,
  applyProgressiveDecay,
  detectSignalsFromMessage,
  progressiveDecayDelta,
  SCORE_DELTAS
} from "./lib/scoring.js";
export { changeLeadStage } from "./lib/leads.js";
export { transitionConversationStatus } from "./lib/conversations.js";
export * from "./types.js";
