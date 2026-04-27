"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../lib/api";

type AgentRow = {
  id: string;
  name: string;
  type: "inbound" | "outbound";
  model: string;
  active: boolean;
  createdAt: string;
};

export default function AgentsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<"" | "inbound" | "outbound">("");

  const { data, isLoading } = useQuery({
    queryKey: ["agents", typeFilter],
    queryFn: () => {
      const qs = typeFilter ? `?type=${typeFilter}` : "";
      return api.get<{ agents: AgentRow[] }>(`/agents${qs}`);
    }
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"inbound" | "outbound">("inbound");
  const [model, setModel] = useState("gpt-5-mini");

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/agents", {
        name,
        type,
        model,
        systemPrompt:
          type === "outbound"
            ? "Você inicia a abordagem de leads recém-captados pela Pointer Imóveis."
            : "Você atende leads e dá continuidade às conversas vindas do WhatsApp.",
        behaviorJson: {
          temperature: 0.7,
          max_tokens: 500,
          delay_range_ms: [8000, 15000],
          tools_enabled:
            type === "outbound"
              ? ["update_stage", "transfer_to_broker", "schedule_visit", "send_property"]
              : [
                  "transfer_to_broker",
                  "schedule_visit",
                  "update_stage",
                  "send_property"
                ]
        }
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      setName("");
      setCreating(false);
      if (data?.id) router.push(`/app/agents/${data.id}`);
    }
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/agents/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] })
  });

  if (isLoading) return <PageShell>Carregando…</PageShell>;

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold text-neutral-900">Agentes de IA</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Novo agente
        </button>
      </div>

      <div className="mb-4 flex gap-2 text-sm">
        <FilterPill label="Todos" active={typeFilter === ""} onClick={() => setTypeFilter("")} />
        <FilterPill label="Inbound" active={typeFilter === "inbound"} onClick={() => setTypeFilter("inbound")} />
        <FilterPill label="Outbound" active={typeFilter === "outbound"} onClick={() => setTypeFilter("outbound")} />
      </div>

      {creating && (
        <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700">Novo agente</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nome">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
                placeholder="ex: Atendimento Inbound"
              />
            </Field>
            <Field label="Tipo">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "inbound" | "outbound")}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
              >
                <option value="inbound">Inbound (responde lead)</option>
                <option value="outbound">Outbound (inicia abordagem)</option>
              </select>
            </Field>
            <Field label="Modelo">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
              >
                <option value="gpt-5">GPT-5</option>
                <option value="gpt-5-mini">GPT-5 Mini</option>
                <option value="gpt-5-nano">GPT-5 Nano</option>
                <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name || createMutation.isPending}
              className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {createMutation.isPending ? "Criando…" : "Criar e editar"}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
          {createMutation.isError && (
            <p className="mt-3 text-xs text-red-600">
              Erro ao criar: {createMutation.error?.message}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {data?.agents.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-900">{a.name}</span>
                <TypePill type={a.type} />
                {a.active && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    ativo
                  </span>
                )}
              </div>
              <span className="text-xs text-neutral-400">{a.model}</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/app/agents/${a.id}`}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Editar
              </Link>
              <button
                onClick={() => toggleMutation.mutate(a.id)}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                {a.active ? "Desativar" : "Ativar"}
              </button>
              <button
                onClick={() => {
                  if (confirm("Remover agente?")) deleteMutation.mutate(a.id);
                }}
                className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
        {data?.agents.length === 0 && (
          <p className="text-center text-sm text-neutral-400 py-10">
            Nenhum agente. Crie um inbound + um outbound para começar uma campanha.
          </p>
        )}
      </div>
    </PageShell>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-pi-primary text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
      }`}
    >
      {label}
    </button>
  );
}

function TypePill({ type }: { type: "inbound" | "outbound" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        type === "outbound" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
      }`}
    >
      {type}
    </span>
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

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl mx-auto p-6">{children}</div>;
}
