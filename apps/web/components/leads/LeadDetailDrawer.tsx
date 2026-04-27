"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../lib/api";
import { Drawer, DrawerTabs } from "../Drawer";

type Stage = { id: string; name: string; category: "open" | "won" | "lost"; color: string | null };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  origin: string | null;
  propertyRef: string | null;
  createdAt: string;
  assignedBroker: { id: string; displayName: string } | null;
  source: { id: string; name: string } | null;
  pipelineStage: Stage | null;
  conversations: {
    id: string;
    status: string;
    aiPaused: boolean;
    createdAt: string;
    lastMessageAt: string | null;
  }[];
};

type Actions = {
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

const CATEGORY_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-50 text-red-600"
};

export function LeadDetailDrawer({
  leadId,
  onClose
}: {
  leadId: string | null;
  onClose: () => void;
}) {
  const open = leadId !== null;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"data" | "timeline" | "edit">("data");

  const leadQuery = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => api.get<{ lead: Lead }>(`/leads/${leadId}`),
    enabled: open
  });
  const lead = leadQuery.data?.lead;

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>("/pipelines"),
    enabled: open
  });
  const stages =
    (pipelinesQuery.data?.pipelines.find((p) => p.isDefault) ?? pipelinesQuery.data?.pipelines[0])
      ?.stages ?? [];

  // First conversation (most recent) for timeline context
  const conversationId = lead?.conversations?.[0]?.id ?? null;
  const actionsQuery = useQuery({
    queryKey: ["lead-actions", conversationId],
    queryFn: () =>
      conversationId ? api.get<Actions>(`/conversations/${conversationId}/actions`) : null,
    enabled: open && tab === "timeline" && conversationId !== null
  });

  const stageMut = useMutation({
    mutationFn: (stageId: string) => api.patch(`/leads/${leadId}/stage`, { stageId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={lead?.name ?? lead?.phone ?? "Lead"}
      width={520}
    >
      {leadQuery.isLoading || !lead ? (
        <div className="text-sm text-neutral-400 py-8 text-center">Carregando…</div>
      ) : (
        <>
          <DrawerTabs
            tabs={[
              { id: "data", label: "Dados" },
              { id: "timeline", label: "Timeline" },
              { id: "edit", label: "Editar" }
            ]}
            active={tab}
            onChange={(id) => setTab(id as "data" | "timeline" | "edit")}
          />

          {tab === "data" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-neutral-700">{lead.phone}</p>
                  {lead.email && <p className="text-xs text-neutral-400">{lead.email}</p>}
                </div>
                <select
                  value={lead.pipelineStage?.id ?? ""}
                  onChange={(e) => stageMut.mutate(e.target.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border-0 cursor-pointer focus:ring-2 focus:ring-pi-primary focus:outline-none ${
                    CATEGORY_COLORS[lead.pipelineStage?.category ?? "open"] ?? "bg-neutral-100"
                  }`}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {lead.origin && <Detail label="Origem" value={lead.origin} />}
                {lead.propertyRef && <Detail label="Imóvel" value={lead.propertyRef} />}
                {lead.source && <Detail label="Fonte" value={lead.source.name} />}
                {lead.assignedBroker && <Detail label="Corretor" value={lead.assignedBroker.displayName} />}
                <Detail label="Criado em" value={new Date(lead.createdAt).toLocaleDateString("pt-BR")} />
              </div>

              {lead.conversations.length > 0 && (
                <div className="pt-3 border-t border-neutral-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                    Conversas ({lead.conversations.length})
                  </p>
                  <div className="space-y-1.5">
                    {lead.conversations.map((c) => (
                      <Link
                        key={c.id}
                        href={`/app/inbox/${c.id}`}
                        className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-2 hover:bg-neutral-50"
                      >
                        <span className="text-xs text-neutral-700">
                          {c.status === "ai_active"
                            ? "IA ativa"
                            : c.status === "handed_off"
                              ? "Com corretor"
                              : "Fechada"}
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          {c.lastMessageAt
                            ? new Date(c.lastMessageAt).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit"
                              })
                            : "—"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "timeline" && (
            <div className="space-y-3">
              {!conversationId ? (
                <p className="text-sm text-neutral-400 text-center py-8">
                  Lead sem conversa ainda — sem ações registradas.
                </p>
              ) : actionsQuery.isLoading ? (
                <p className="text-sm text-neutral-400 text-center py-8">Carregando…</p>
              ) : (
                <>
                  {(actionsQuery.data?.actions.tools ?? []).map((t) => (
                    <TimelineRow
                      key={t.id}
                      icon="🤖"
                      title={TOOL_LABELS[t.toolName] ?? t.toolName}
                      when={t.createdAt}
                      detail={t.error ?? formatToolDetail(t.toolName, t.result)}
                      status={t.status}
                    />
                  ))}
                  {(actionsQuery.data?.actions.followups ?? []).map((f) => (
                    <TimelineRow
                      key={f.id}
                      icon="⏰"
                      title={FOLLOWUP_LABELS[f.step] ?? f.step}
                      when={f.scheduledFor}
                      detail={f.triggerEvent}
                      status={f.status}
                    />
                  ))}
                  {(actionsQuery.data?.actions.tools.length ?? 0) === 0 &&
                    (actionsQuery.data?.actions.followups.length ?? 0) === 0 && (
                      <p className="text-sm text-neutral-400 text-center py-8">
                        Nenhuma ação registrada nessa conversa ainda.
                      </p>
                    )}
                </>
              )}
            </div>
          )}

          {tab === "edit" && (
            <div className="text-sm text-neutral-400 italic py-8 text-center">
              Edição de campos virá em iteração futura — por hora use{" "}
              <Link href={`/app/leads/${lead.id}`} className="text-pi-primary hover:underline">
                a página completa do lead
              </Link>
              .
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="text-neutral-700">{value}</p>
    </div>
  );
}

function TimelineRow({
  icon,
  title,
  when,
  detail,
  status
}: {
  icon: string;
  title: string;
  when: string;
  detail: string | null;
  status: string;
}) {
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
    <div className="flex items-start gap-3 rounded-lg border border-neutral-100 px-3 py-2.5">
      <span className="text-base mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-700">{title}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] ${
              statusColor[status] ?? "bg-neutral-100 text-neutral-500"
            }`}
          >
            {status}
          </span>
        </div>
        <p className="text-[11px] text-neutral-400 mt-0.5">
          {new Date(when).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          })}
        </p>
        {detail && <p className="text-xs text-neutral-500 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function formatToolDetail(name: string, result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  if (name === "schedule_visit") {
    return `Para ${result.scheduledFor ?? "?"}${
      result.address ? ` em ${result.address}` : ""
    }`;
  }
  if (name === "update_stage") {
    return `Estágio: ${result.stageName ?? result.stage_name ?? ""}`;
  }
  if (name === "transfer_to_broker") {
    return `Motivo: ${result.reason ?? ""}`;
  }
  return null;
}
