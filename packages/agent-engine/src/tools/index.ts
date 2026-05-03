import type { ToolRegistry } from "../types.js";
import { scheduleVisit } from "./schedule-visit.js";
import { sendProperty } from "./send-property.js";
import { transferToBroker } from "./transfer-to-broker.js";
import { updateStage } from "./update-stage.js";

/**
 * Built-in tool registry. The engine merges this with any agent-specific
 * `behavior.tools_enabled` allow-list to decide what gets exposed to the LLM
 * and what handlers run on tool calls.
 */
export const builtInTools: ToolRegistry = {
  [transferToBroker.definition.name]: transferToBroker,
  [scheduleVisit.definition.name]: scheduleVisit,
  [updateStage.definition.name]: updateStage,
  [sendProperty.definition.name]: sendProperty
};

/** Legacy alias from Phase A: handoff_to_broker now resolves to transfer_to_broker. */
export const TOOL_NAME_ALIASES: Record<string, string> = {
  handoff_to_broker: "transfer_to_broker"
};

export function resolveToolName(rawName: string): string {
  return TOOL_NAME_ALIASES[rawName] ?? rawName;
}
