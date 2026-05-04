import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import type { ConversationStatus } from "@pointer/shared";
import { eq } from "drizzle-orm";
import { recordEvent } from "./domain-events.js";

const VALID_TRANSITIONS: Record<ConversationStatus, readonly ConversationStatus[]> = {
  ai_active: ["handed_off", "closed"],
  handed_off: ["ai_active", "closed"],
  closed: []
};

export async function transitionConversationStatus(
  db: Database,
  conversationId: string,
  newStatus: ConversationStatus,
  opts: {
    handoffReason?: string | null;
    assignBrokerId?: string | null;
    aiPaused?: boolean;
    actor?: string | null;
  } = {}
): Promise<{ changed: boolean }> {
  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversationId),
    columns: { id: true, status: true }
  });
  if (!conv) {
    throw new Error(`conversation not found: ${conversationId}`);
  }

  if (conv.status === newStatus) {
    return { changed: false };
  }

  const allowed = VALID_TRANSITIONS[conv.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(`invalid conversation transition: ${conv.status} → ${newStatus}`);
  }

  const patch: Partial<typeof schema.conversations.$inferInsert> = { status: newStatus };

  if (newStatus === "handed_off") {
    patch.aiPaused = true;
  }
  if (newStatus === "ai_active") {
    patch.handoffReason = null;
  }

  if (opts.handoffReason !== undefined) {
    patch.handoffReason = opts.handoffReason;
  }
  if (opts.assignBrokerId !== undefined) {
    patch.assignedBrokerId = opts.assignBrokerId ?? undefined;
  }
  if (opts.aiPaused !== undefined && newStatus !== "handed_off") {
    patch.aiPaused = opts.aiPaused;
  }

  await db
    .update(schema.conversations)
    .set(patch)
    .where(eq(schema.conversations.id, conversationId));

  await recordEvent(db, "conversation", conversationId, "conversation.status_changed", {
    actor: opts.actor ?? null,
    payload: {
      from: conv.status,
      to: newStatus,
      handoffReason: patch.handoffReason ?? null,
      assignedBrokerId: patch.assignedBrokerId ?? null
    }
  });

  return { changed: true };
}
