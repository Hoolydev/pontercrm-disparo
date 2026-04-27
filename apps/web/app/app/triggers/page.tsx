"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";

type Trigger = {
  id: string;
  name: string;
  patternType: "keyword" | "regex" | "llm_classifier" | "tool_call";
  pattern: string;
  action: string;
  priority: number;
  active: boolean;
  aiConfigId: string | null;
};

const PATTERN_LABELS: Record<string, string> = {
  keyword: "Palavra-chave",
  regex: "Regex",
  llm_classifier: "Classificador LLM",
  tool_call: "Tool call IA"
};

const ACTION_LABELS: Record<string, string> = {
  assign_broker: "Atribuir corretor",
  pause_ai: "Pausar IA",
  notify: "Notificar"
};

const emptyForm = {
  name: "",
  patternType: "keyword" as Trigger["patternType"],
  pattern: "",
  action: "pause_ai",
  priority: 10
};

export default function TriggersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["triggers"],
    queryFn: () => api.get<{ triggers: Trigger[] }>("/handoff-triggers")
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const createMutation = useMutation({
    mutationFn: () => api.post("/handoff-triggers", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["triggers"] });
      setShowForm(false);
      setForm(emptyForm);
    }
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/handoff-triggers/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["triggers"] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/handoff-triggers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["triggers"] })
  });

  const sorted = [...(data?.triggers ?? [])].sort((a, b) => a.priority - b.priority);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Triggers de Handoff</h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Ordem de avaliação pelo campo prioridade (menor = primeiro)
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Novo trigger
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700">Novo trigger</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Nome</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="ex: Intenção de visita"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Tipo</label>
              <select
                value={form.patternType}
                onChange={(e) =>
                  setForm({ ...form, patternType: e.target.value as Trigger["patternType"] })
                }
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(PATTERN_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {form.patternType !== "tool_call" && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  {form.patternType === "keyword" ? "Palavras-chave (separadas por vírgula)" : "Padrão"}
                </label>
                <input
                  value={form.pattern}
                  onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={
                    form.patternType === "keyword"
                      ? "visitar, agendar, proposta, valor"
                      : form.patternType === "regex"
                      ? "(quero|posso).*(visitar|ver|agendar)"
                      : "Intenção clara de visita ou proposta?"
                  }
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Ação</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(ACTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Prioridade (menor = primeiro)
              </label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!form.name || createMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? "Criando…" : "Criar trigger"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-neutral-400">Carregando…</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => (
            <div
              key={t.id}
              className={`flex items-center justify-between rounded-xl border bg-white p-4 shadow-sm ${
                t.active ? "border-neutral-200" : "border-neutral-100 opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">{t.name}</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                    p{t.priority}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                    {PATTERN_LABELS[t.patternType] ?? t.patternType}
                  </span>
                  <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">
                    {ACTION_LABELS[t.action] ?? t.action}
                  </span>
                </div>
                {t.pattern && (
                  <p className="mt-1 truncate text-xs text-neutral-400 font-mono">{t.pattern}</p>
                )}
              </div>
              <div className="ml-4 flex items-center gap-2">
                <button
                  onClick={() => toggleMutation.mutate(t.id)}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  {t.active ? "Desativar" : "Ativar"}
                </button>
                <button
                  onClick={() => {
                    if (confirm("Remover trigger?")) deleteMutation.mutate(t.id);
                  }}
                  className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
          {sorted.length === 0 && (
            <p className="text-center text-sm text-neutral-400 py-10">
              Nenhum trigger configurado ainda.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
