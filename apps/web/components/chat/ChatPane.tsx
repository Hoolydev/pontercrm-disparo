"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type ConversationDetail, type Message } from "../../lib/api";
import MessageComposer from "./MessageComposer";

type Stage = { id: string; name: string; category: "open" | "won" | "lost"; color: string | null };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };

type ActionsResponse = {
  actions: {
    tools: {
      id: string;
      toolName: string;
      arguments: Record<string, unknown>;
      result: Record<string, unknown> | null;
      status: "ok" | "error" | "duplicate";
      error: string | null;
      createdAt: string;
    }[];
    followups: {
      id: string;
      step: string;
      status: "pending" | "sent" | "skipped" | "done" | "cancelled";
      scheduledFor: string;
      triggerEvent: string | null;
      result: Record<string, unknown> | null;
      createdAt: string;
    }[];
  };
};

const TOOL_LABELS: Record<string, string> = {
  transfer_to_broker: "Transferiu para corretor",
  schedule_visit: "Agendou visita",
  update_stage: "Moveu lead no funil",
  handoff_to_broker: "Transferiu para corretor"
};

const FOLLOWUP_LABELS: Record<string, string> = {
  broker_30min: "Cobrança +30min",
  broker_24h: "Cobrança +24h",
  broker_48h: "Cobrança +48h",
  broker_5d: "Cobrança +5 dias",
  redistribute_15d: "Redistribuição +15 dias"
};

const STAGE_CATEGORY_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-neutral-100 text-neutral-500"
};

export default function ChatPane({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () =>
      api.get<{ conversation: ConversationDetail }>(`/conversations/${conversationId}`).then(
        (r) => r.conversation
      )
  });

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>("/pipelines")
  });

  // Resolve which pipeline's stages to show:
  //  - If campaign has a pipelineId, use that pipeline
  //  - Else fallback to the default pipeline
  const stages = (() => {
    const pipelines = pipelinesQuery.data?.pipelines ?? [];
    const campaignPipelineId = data?.campaign?.pipelineId;
    const target =
      pipelines.find((p) => p.id === campaignPipelineId) ??
      pipelines.find((p) => p.isDefault) ??
      pipelines[0];
    return target?.stages ?? [];
  })();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length]);

  const takeover = useMutation({
    mutationFn: () => api.post(`/conversations/${conversationId}/takeover`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation", conversationId] })
  });

  const release = useMutation({
    mutationFn: () => api.post(`/conversations/${conversationId}/release`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation", conversationId] })
  });

  const stageMut = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) =>
      api.patch(`/leads/${leadId}/stage`, { stageId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
  });

  const [showActions, setShowActions] = useState(false);
  const actionsQuery = useQuery({
    queryKey: ["conversation-actions", conversationId],
    queryFn: () => api.get<ActionsResponse>(`/conversations/${conversationId}/actions`),
    enabled: showActions
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        Carregando conversa…
      </div>
    );
  }
  if (!data) return null;

  const lead = data.lead;
  const messages = [...(data.messages ?? [])].reverse();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-800">{lead.name ?? lead.phone}</p>
          <p className="text-xs text-neutral-400">{lead.phone}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {data.campaign && (
              <Link
                href={`/app/campaigns/${data.campaign.id}`}
                className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-100"
              >
                {data.campaign.name}
              </Link>
            )}
            {data.agent && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600">
                {data.agent.type === "outbound" ? "Outbound" : "Inbound"} · {data.agent.name}
              </span>
            )}
            {stages.length > 0 && (
              <select
                value={lead.pipelineStage?.id ?? ""}
                onChange={(e) => stageMut.mutate({ leadId: lead.id, stageId: e.target.value })}
                className={`rounded-full border-0 px-2 py-0.5 text-[10px] font-medium cursor-pointer focus:ring-2 focus:ring-blue-500 focus:outline-none ${
                  STAGE_CATEGORY_COLORS[lead.pipelineStage?.category ?? "open"] ??
                  "bg-neutral-100 text-neutral-500"
                }`}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {data.aiPaused ? (
            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700">
              IA pausada
            </span>
          ) : (
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
              IA ativa
            </span>
          )}

          {data.aiPaused ? (
            <button
              onClick={() => release.mutate()}
              disabled={release.isPending}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
            >
              Devolver à IA
            </button>
          ) : (
            <button
              onClick={() => takeover.mutate()}
              disabled={takeover.isPending}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Assumir
            </button>
          )}
        </div>
      </div>

      {/* Sub-toolbar: actions toggle */}
      <div className="border-b border-neutral-100 bg-white px-5 py-1.5">
        <button
          onClick={() => setShowActions((v) => !v)}
          className="text-xs text-neutral-500 hover:text-blue-600"
        >
          {showActions ? "Ocultar ações da IA ▲" : "Ver ações da IA + cobranças ▼"}
        </button>
      </div>

      {showActions && (
        <ActionLog
          actions={actionsQuery.data?.actions}
          loading={actionsQuery.isLoading}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversationId}
        disabled={!data.aiPaused}
        onSent={() => qc.invalidateQueries({ queryKey: ["conversation", conversationId] })}
      />
    </div>
  );
}

function ActionLog({
  actions,
  loading
}: {
  actions: ActionsResponse["actions"] | undefined;
  loading: boolean;
}) {
  if (loading) {
    return <div className="px-5 py-3 text-xs text-neutral-400">Carregando ações…</div>;
  }
  if (!actions || (actions.tools.length === 0 && actions.followups.length === 0)) {
    return (
      <div className="px-5 py-3 text-xs text-neutral-400">
        Nenhuma ação automatizada nesta conversa ainda.
      </div>
    );
  }
  return (
    <div className="border-b border-neutral-100 bg-neutral-50 px-5 py-3 space-y-2 max-h-48 overflow-auto">
      {actions.tools.map((t) => (
        <ActionRow
          key={t.id}
          when={t.createdAt}
          icon="🤖"
          title={TOOL_LABELS[t.toolName] ?? t.toolName}
          status={t.status}
          detail={
            t.error
              ? t.error
              : t.toolName === "schedule_visit" && t.result
                ? `Para ${t.result.scheduledFor}${t.result.address ? ` em ${t.result.address}` : ""}`
                : t.toolName === "update_stage" && t.result
                  ? `Estágio: ${t.result.stageName}`
                  : t.toolName === "transfer_to_broker" && t.result
                    ? `Motivo: ${t.result.reason}`
                    : null
          }
        />
      ))}
      {actions.followups.map((f) => (
        <ActionRow
          key={f.id}
          when={f.scheduledFor}
          icon="⏰"
          title={FOLLOWUP_LABELS[f.step] ?? f.step}
          status={f.status}
          detail={f.triggerEvent ?? null}
        />
      ))}
    </div>
  );
}

function ActionRow({
  when,
  icon,
  title,
  status,
  detail
}: {
  when: string;
  icon: string;
  title: string;
  status: string;
  detail: string | null;
}) {
  const date = new Date(when);
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);

  const statusColor: Record<string, string> = {
    ok: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    duplicate: "bg-neutral-100 text-neutral-500",
    pending: "bg-blue-100 text-blue-700",
    sent: "bg-green-100 text-green-700",
    skipped: "bg-neutral-100 text-neutral-500",
    done: "bg-emerald-100 text-emerald-700",
    cancelled: "bg-neutral-100 text-neutral-400"
  };

  return (
    <div className="flex items-start gap-2 text-xs">
      <span>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-700">{title}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusColor[status] ?? "bg-neutral-100 text-neutral-500"}`}>
            {status}
          </span>
          <span className="text-neutral-400">{formatted}</span>
        </div>
        {detail && <p className="text-neutral-500 truncate">{detail}</p>}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === "in";
  const label =
    message.senderType === "ai"
      ? "IA"
      : message.senderType === "broker"
        ? "Corretor"
        : message.senderType === "system"
          ? "Sistema"
          : "Lead";

  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(message.createdAt)
  );

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[72%] rounded-2xl px-4 py-2.5 text-sm ${
          isInbound
            ? "bg-white border border-neutral-200 text-neutral-800"
            : message.senderType === "ai"
              ? "bg-blue-600 text-white"
              : "bg-neutral-800 text-white"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <div
          className={`mt-1 flex items-center gap-1 text-[10px] ${
            isInbound ? "text-neutral-400" : "text-white/60"
          }`}
        >
          <span>{label}</span>
          <span>·</span>
          <span>{time}</span>
          {!isInbound && (
            <>
              <span>·</span>
              <span>{message.status}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
