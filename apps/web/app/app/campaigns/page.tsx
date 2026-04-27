"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../lib/api";

type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  outboundAgent: { id: string; name: string } | null;
  inboundAgent: { id: string; name: string } | null;
  pipeline: { id: string; name: string };
  createdAt: string;
};

type Agent = { id: string; name: string; type: "inbound" | "outbound"; active: boolean };
type Pipeline = { id: string; name: string; isDefault: boolean };

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada"
};
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  archived: "bg-neutral-100 text-neutral-400"
};

export default function CampaignsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<{ campaigns: CampaignRow[] }>("/campaigns")
  });

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<{ agents: Agent[] }>("/agents?active=true")
  });

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>("/pipelines")
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [outboundAgentId, setOutboundAgentId] = useState<string>("");
  const [inboundAgentId, setInboundAgentId] = useState<string>("");
  const [pipelineId, setPipelineId] = useState<string>("");

  const inboundAgents = agentsQuery.data?.agents.filter((a) => a.type === "inbound") ?? [];
  const outboundAgents = agentsQuery.data?.agents.filter((a) => a.type === "outbound") ?? [];
  const pipelines = pipelinesQuery.data?.pipelines ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/campaigns", {
        name,
        outboundAgentId: outboundAgentId || null,
        inboundAgentId: inboundAgentId || null,
        pipelineId: pipelineId || undefined
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setName("");
      setCreating(false);
      window.location.href = `/app/campaigns/${res.id}`;
    }
  });

  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "start" | "pause" | "resume" | "archive" }) =>
      api.post(`/campaigns/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] })
  });

  if (isLoading) return <div className="max-w-4xl mx-auto p-6">Carregando…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold text-neutral-900">Campanhas</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Nova campanha
        </button>
      </div>

      {creating && (
        <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700">Nova campanha</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Lançamento Vila Madalena"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Funil">
              <select
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Padrão —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.isDefault ? "(padrão)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Agente outbound (1ª abordagem)">
              <select
                value={outboundAgentId}
                onChange={(e) => setOutboundAgentId(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Selecionar —</option>
                {outboundAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Agente inbound (responde lead)">
              <select
                value={inboundAgentId}
                onChange={(e) => setInboundAgentId(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Selecionar —</option>
                {inboundAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name || createMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? "Criando…" : "Criar e configurar"}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {data?.campaigns.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <div>
              <div className="flex items-center gap-2">
                <Link href={`/app/campaigns/${c.id}`} className="text-sm font-medium text-neutral-900 hover:underline">
                  {c.name}
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                  {STATUS_LABELS[c.status]}
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Funil: {c.pipeline.name}
                {c.outboundAgent ? ` · Outbound: ${c.outboundAgent.name}` : ""}
                {c.inboundAgent ? ` · Inbound: ${c.inboundAgent.name}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              {c.status === "draft" && (
                <ActionBtn label="Iniciar" onClick={() => lifecycle.mutate({ id: c.id, action: "start" })} primary />
              )}
              {c.status === "active" && (
                <ActionBtn label="Pausar" onClick={() => lifecycle.mutate({ id: c.id, action: "pause" })} />
              )}
              {c.status === "paused" && (
                <ActionBtn label="Retomar" onClick={() => lifecycle.mutate({ id: c.id, action: "resume" })} primary />
              )}
              {c.status !== "archived" && (
                <ActionBtn label="Arquivar" onClick={() => lifecycle.mutate({ id: c.id, action: "archive" })} />
              )}
              <Link
                href={`/app/campaigns/${c.id}`}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Detalhes
              </Link>
            </div>
          </div>
        ))}
        {data?.campaigns.length === 0 && (
          <p className="text-center text-sm text-neutral-400 py-10">
            Nenhuma campanha ainda. Crie a primeira.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ActionBtn({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
        primary
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      {label}
    </button>
  );
}
