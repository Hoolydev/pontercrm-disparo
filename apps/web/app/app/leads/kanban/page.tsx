"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type DragEvent } from "react";
import { api } from "../../../../lib/api";
import { LeadDetailDrawer } from "../../../../components/leads/LeadDetailDrawer";

type Stage = {
  id: string;
  name: string;
  position: number;
  category: "open" | "won" | "lost";
  color: string | null;
};
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };

type Lead = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  origin: string | null;
  propertyRef: string | null;
  createdAt: string;
  source: { id: string; name: string; type: string } | null;
  assignedBroker: { id: string; displayName: string } | null;
  pipelineStage: Stage | null;
};

type Broker = { id: string; displayName: string };

const CATEGORY_BG: Record<string, string> = {
  open: "bg-blue-50",
  won: "bg-emerald-50",
  lost: "bg-neutral-50"
};
const CATEGORY_DOT: Record<string, string> = {
  open: "bg-pi-primary",
  won: "bg-emerald-500",
  lost: "bg-neutral-400"
};

export default function LeadsKanbanPage() {
  const qc = useQueryClient();
  const [brokerFilter, setBrokerFilter] = useState("");
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>("/pipelines")
  });
  const stages =
    (pipelinesQuery.data?.pipelines.find((p) => p.isDefault) ?? pipelinesQuery.data?.pipelines[0])
      ?.stages ?? [];

  const qs = new URLSearchParams();
  if (brokerFilter) qs.set("brokerId", brokerFilter);
  qs.set("page", "1");

  const { data, isLoading } = useQuery({
    queryKey: ["leads-kanban", brokerFilter],
    queryFn: () => api.get<{ leads: Lead[] }>(`/leads?${qs.toString()}`),
    refetchInterval: 60_000
  });

  const brokersQuery = useQuery({
    queryKey: ["brokers-list"],
    queryFn: () => api.get<{ brokers: Broker[] }>("/brokers").catch(() => ({ brokers: [] }))
  });

  const moveStage = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      api.patch(`/leads/${id}/stage`, { stageId }),
    onMutate: async ({ id, stageId }) => {
      // Optimistic: swap stage on the lead row in the cached list
      await qc.cancelQueries({ queryKey: ["leads-kanban", brokerFilter] });
      const prev = qc.getQueryData<{ leads: Lead[] }>(["leads-kanban", brokerFilter]);
      if (prev) {
        const stage = stages.find((s) => s.id === stageId) ?? null;
        const next = {
          leads: prev.leads.map((l) =>
            l.id === id ? { ...l, pipelineStage: stage } : l
          )
        };
        qc.setQueryData(["leads-kanban", brokerFilter], next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["leads-kanban", brokerFilter], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["leads-kanban", brokerFilter] });
    }
  });

  function onDragStart(e: DragEvent<HTMLDivElement>, leadId: string) {
    e.dataTransfer.setData("text/lead-id", leadId);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDrop(e: DragEvent<HTMLDivElement>, stageId: string) {
    e.preventDefault();
    setDragOver(null);
    const leadId = e.dataTransfer.getData("text/lead-id");
    if (!leadId) return;
    const lead = data?.leads.find((l) => l.id === leadId);
    if (!lead || lead.pipelineStage?.id === stageId) return;
    moveStage.mutate({ id: leadId, stageId });
  }

  const groupedByStage: Record<string, Lead[]> = {};
  for (const stage of stages) groupedByStage[stage.id] = [];
  for (const lead of data?.leads ?? []) {
    const stageId = lead.pipelineStage?.id;
    if (stageId && groupedByStage[stageId]) groupedByStage[stageId].push(lead);
  }

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Leads · Kanban</h1>
          <p className="text-xs text-neutral-400">Arraste cartões entre colunas para mover de estágio</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value)}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
          >
            <option value="">Todos os corretores</option>
            {brokersQuery.data?.brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
          <Link
            href="/app/leads"
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Ver lista
          </Link>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        {isLoading ? (
          <p className="text-center text-sm text-neutral-400 py-12">Carregando…</p>
        ) : stages.length === 0 ? (
          <p className="text-center text-sm text-neutral-400 py-12">
            Nenhum estágio configurado. Vá em Funis → criar.
          </p>
        ) : (
          <div className="flex gap-3 h-full" style={{ minWidth: stages.length * 280 }}>
            {stages.map((stage) => (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(stage.id);
                }}
                onDragLeave={() => setDragOver((cur) => (cur === stage.id ? null : cur))}
                onDrop={(e) => onDrop(e, stage.id)}
                className={`flex flex-col w-72 flex-shrink-0 rounded-2xl ${
                  CATEGORY_BG[stage.category]
                } ${dragOver === stage.id ? "ring-2 ring-pi-primary" : ""}`}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[stage.category]}`} />
                    <p className="text-sm font-semibold text-neutral-800">{stage.name}</p>
                  </div>
                  <span className="text-xs font-medium text-neutral-500">
                    {groupedByStage[stage.id]?.length ?? 0}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {(groupedByStage[stage.id] ?? []).map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, lead.id)}
                      onClick={() => setOpenLeadId(lead.id)}
                      className="bg-white rounded-xl border border-neutral-200 p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                    >
                      <p className="text-sm font-medium text-neutral-800 truncate">
                        {lead.name ?? lead.phone}
                      </p>
                      <p className="text-[11px] text-neutral-400 truncate">{lead.phone}</p>
                      {lead.propertyRef && (
                        <p className="text-[11px] text-neutral-500 mt-1 truncate">
                          {lead.propertyRef}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        {lead.source && (
                          <span className="text-[10px] text-neutral-400">{lead.source.name}</span>
                        )}
                        {lead.assignedBroker && (
                          <span className="text-[10px] text-neutral-500 truncate max-w-[120px]">
                            {lead.assignedBroker.displayName}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {(groupedByStage[stage.id]?.length ?? 0) === 0 && (
                    <p className="text-center text-[11px] text-neutral-300 py-6">vazio</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <LeadDetailDrawer leadId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </div>
  );
}
