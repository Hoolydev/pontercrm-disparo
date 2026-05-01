"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type ConversationSummary } from "../../lib/api";
import { getToken } from "../../lib/session";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

type Filter = "all" | "failed";

type WhatsappInstance = {
  id: string;
  number: string;
  status: string;
  active: boolean;
};

const DELAY_PRESETS = [
  { value: 12, label: "12s (rápido)" },
  { value: 20, label: "20s (recomendado)" },
  { value: 30, label: "30s (seguro)" },
  { value: 60, label: "60s (conservador)" },
  { value: 120, label: "2min (lento)" }
];

export default function ConversationListPane({ activeId }: { activeId?: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRetryModal, setShowRetryModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["conversations", filter],
    queryFn: () => {
      const url =
        filter === "failed"
          ? "/conversations?failed=true&limit=5000"
          : "/conversations?limit=5000";
      return api.get<{ conversations: ConversationSummary[]; failedCount: number }>(url);
    },
    refetchInterval: 30_000
  });

  const conversations = data?.conversations ?? [];
  const failedCount = data?.failedCount ?? 0;

  // SSE for live updates
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${API}/stream/inbox?token=${encodeURIComponent(token)}`);
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

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelectedIds(new Set(conversations.map((c) => c.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  function exitSelectionMode() {
    setSelecting(false);
    setSelectedIds(new Set());
    setShowRetryModal(false);
  }

  return (
    <div className="relative flex w-80 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-800">Conversas</h2>
        {isLoading && <span className="text-xs text-neutral-400">…</span>}
      </div>

      {/* Filtros — destaque visual forte pra não ficar escondido */}
      <div className="flex gap-1 border-b-2 border-neutral-200 bg-neutral-50 px-2 py-2">
        <FilterTab label="Todas" active={filter === "all"} onClick={() => { setFilter("all"); exitSelectionMode(); }} />
        <FilterTab
          label={`Falhas${failedCount > 0 ? ` (${failedCount})` : ""}`}
          active={filter === "failed"}
          onClick={() => { setFilter("failed"); exitSelectionMode(); }}
          variant="failed"
        />
      </div>

      {/* Toolbar de seleção (só aparece no filtro "Falhas") */}
      {filter === "failed" && (
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 text-xs">
          {!selecting ? (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
            >
              Selecionar para reenvio
            </button>
          ) : (
            <>
              <span className="font-medium text-neutral-700">{selectedIds.size} selecionada(s)</span>
              <div className="flex gap-1">
                <button type="button" onClick={selectAllVisible} className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100">
                  Todos
                </button>
                <button type="button" onClick={clearSelection} className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100">
                  Limpar
                </button>
                <button type="button" onClick={exitSelectionMode} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-400">
            {filter === "failed" ? "Nenhuma falha" : "Nenhuma conversa ainda"}
          </p>
        )}
        {conversations.map((c) => (
          <ConversationRow
            key={c.id}
            conv={c}
            active={c.id === activeId}
            selecting={selecting}
            selected={selectedIds.has(c.id)}
            onToggle={() => toggleId(c.id)}
          />
        ))}
        {selecting && <div className="h-20" /> /* espaço pro footer não cobrir o último item */}
      </div>

      {/* Footer fixo com ação de reenvio */}
      {selecting && selectedIds.size > 0 && (
        <div className="absolute inset-x-0 bottom-0 border-t border-red-200 bg-red-50 p-3 shadow-lg">
          <button
            type="button"
            onClick={() => setShowRetryModal(true)}
            className="w-full rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Reenviar {selectedIds.size} mensagem(ns)
          </button>
        </div>
      )}

      {showRetryModal && (
        <RetryModal
          conversationIds={Array.from(selectedIds)}
          onClose={() => setShowRetryModal(false)}
          onSuccess={() => {
            exitSelectionMode();
            qc.invalidateQueries({ queryKey: ["conversations"] });
          }}
        />
      )}
    </div>
  );
}

function FilterTab({
  label,
  active,
  onClick,
  variant
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  variant?: "failed";
}) {
  const activeCls =
    variant === "failed"
      ? "bg-red-600 text-white shadow-sm"
      : "bg-blue-600 text-white shadow-sm";
  const inactiveCls =
    variant === "failed"
      ? "text-red-700 hover:bg-red-50 border border-red-200"
      : "text-neutral-600 hover:bg-white border border-neutral-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
        active ? activeCls : inactiveCls
      }`}
    >
      {label}
    </button>
  );
}

function ConversationRow({
  conv,
  active,
  selecting,
  selected,
  onToggle
}: {
  conv: ConversationSummary;
  active: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const last = conv.messages[0];
  const name = conv.lead.name ?? conv.lead.phone;
  const time = conv.lastMessageAt
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(conv.lastMessageAt)
      )
    : "";

  const inner = (
    <div
      className={`flex items-start gap-3 border-b border-neutral-50 px-4 py-3 hover:bg-neutral-50 ${
        active ? "bg-blue-50" : ""
      } ${selected ? "bg-red-50" : ""}`}
    >
      {selecting && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mt-1 h-4 w-4 cursor-pointer accent-red-600"
        />
      )}
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
          {last?.status === "failed" && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
              falhou
            </span>
          )}
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
    </div>
  );

  if (selecting) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="block w-full text-left"
      >
        {inner}
      </button>
    );
  }
  return (
    <Link href={`/app/inbox/${conv.id}`} className="block">
      {inner}
    </Link>
  );
}

function RetryModal({
  conversationIds,
  onClose,
  onSuccess
}: {
  conversationIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [delaySeconds, setDelaySeconds] = useState(20);
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<string>>(new Set());

  const instancesQuery = useQuery({
    queryKey: ["whatsapp-instances"],
    queryFn: () => api.get<{ instances: WhatsappInstance[] }>("/whatsapp-instances")
  });

  const availableInstances = useMemo(
    () => (instancesQuery.data?.instances ?? []).filter((i) => i.active && i.status === "connected"),
    [instancesQuery.data]
  );

  // Auto-select all available on first load
  useEffect(() => {
    if (availableInstances.length > 0 && selectedInstanceIds.size === 0) {
      setSelectedInstanceIds(new Set(availableInstances.map((i) => i.id)));
    }
  }, [availableInstances, selectedInstanceIds.size]);

  const retry = useMutation({
    mutationFn: () =>
      api.post<{ scheduled: number; skipped: number; etaMinutes: number }>(
        "/conversations/retry-failed",
        {
          conversationIds,
          instanceIds: Array.from(selectedInstanceIds),
          delaySeconds
        }
      ),
    onSuccess: (res) => {
      alert(
        `Agendado: ${res.scheduled} mensagem(ns)\nIgnoradas: ${res.skipped}\nETA total: ~${res.etaMinutes} min`
      );
      onSuccess();
    },
    onError: (err: Error) => {
      alert(`Erro: ${err.message}`);
    }
  });

  function toggleInstance(id: string) {
    setSelectedInstanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const etaMinutes = Math.ceil((conversationIds.length * delaySeconds) / 60);
  const canSubmit = selectedInstanceIds.size > 0 && conversationIds.length > 0 && !retry.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Reenviar mensagens falhadas</h3>
        <p className="mt-1 text-sm text-neutral-500">
          {conversationIds.length} conversa(s) selecionada(s). A última mensagem que falhou será
          reenviada para cada uma.
        </p>

        <div className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <strong>⚠ Anti-banimento:</strong> use delay alto (20s+) em instâncias novas. Reenviar em
          rajada pode resultar em banimento permanente do número.
        </div>

        <div className="mt-5">
          <label className="text-sm font-medium text-neutral-800">Números de saída</label>
          <p className="text-xs text-neutral-500">
            Mensagens serão distribuídas em round-robin entre os selecionados.
          </p>
          <div className="mt-2 space-y-2">
            {availableInstances.length === 0 && (
              <p className="text-sm text-red-600">Nenhuma instância conectada disponível.</p>
            )}
            {availableInstances.map((inst) => (
              <label
                key={inst.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={selectedInstanceIds.has(inst.id)}
                  onChange={() => toggleInstance(inst.id)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="text-sm font-mono text-neutral-700">{inst.number}</span>
                <span className="ml-auto rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                  conectada
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <label className="text-sm font-medium text-neutral-800">Delay entre mensagens</label>
          <select
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {DELAY_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-500">
            ETA total: ~{etaMinutes} minuto(s) ({Math.ceil(etaMinutes / 60)}h{" "}
            {etaMinutes % 60}min)
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={retry.isPending}
            className="rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => retry.mutate()}
            disabled={!canSubmit}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {retry.isPending ? "Agendando…" : `Confirmar reenvio (${conversationIds.length})`}
          </button>
        </div>
      </div>
    </div>
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
