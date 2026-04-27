"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";
import { api, type ConversationSummary } from "../../lib/api";
import { getToken } from "../../lib/session";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export default function ConversationListPane({ activeId }: { activeId?: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<{ conversations: ConversationSummary[] }>("/conversations").then((r) => r.conversations),
    refetchInterval: 30_000
  });

  // SSE for live updates
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const es = new EventSource(`${API}/stream/inbox?token=${encodeURIComponent(token)}`);
    // Fastify JWT reads from query for EventSource (no custom headers support)
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.kind === "message:new" || evt.kind === "conversation:update") {
          qc.invalidateQueries({ queryKey: ["conversations"] });
          qc.invalidateQueries({ queryKey: ["conversation", evt.conversationId] });
        }
      } catch {}
    };
    return () => es.close();
  }, [qc]);

  return (
    <div className="flex w-72 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-800">Conversas</h2>
        {isLoading && <span className="text-xs text-neutral-400">…</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {data?.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-400">Nenhuma conversa ainda</p>
        )}
        {data?.map((c) => (
          <ConversationRow key={c.id} conv={c} active={c.id === activeId} />
        ))}
      </div>
    </div>
  );
}

function ConversationRow({ conv, active }: { conv: ConversationSummary; active: boolean }) {
  const last = conv.messages[0];
  const name = conv.lead.name ?? conv.lead.phone;
  const time = conv.lastMessageAt
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(conv.lastMessageAt)
      )
    : "";

  return (
    <Link
      href={`/app/inbox/${conv.id}`}
      className={`flex items-start gap-3 border-b border-neutral-50 px-4 py-3 hover:bg-neutral-50 ${
        active ? "bg-blue-50" : ""
      }`}
    >
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-600">
        {name[0]?.toUpperCase() ?? "?"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-neutral-800">{name}</span>
          <span className="flex-shrink-0 text-xs text-neutral-400">{time}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-500">{last?.content ?? "—"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={conv.status} aiPaused={conv.aiPaused} />
          {conv.campaign && (
            <span
              className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 max-w-[120px] truncate"
              title={`Campanha: ${conv.campaign.name}`}
            >
              {conv.campaign.name}
            </span>
          )}
          {conv.lead.pipelineStage && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                STAGE_CATEGORY_COLORS[conv.lead.pipelineStage.category] ??
                "bg-neutral-100 text-neutral-500"
              }`}
            >
              {conv.lead.pipelineStage.name}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

const STAGE_CATEGORY_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-neutral-100 text-neutral-500"
};

function StatusBadge({ status, aiPaused }: { status: string; aiPaused: boolean }) {
  if (aiPaused)
    return (
      <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
        Corretor
      </span>
    );
  if (status === "ai_active")
    return (
      <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
        IA ativa
      </span>
    );
  return (
    <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
      {status}
    </span>
  );
}
