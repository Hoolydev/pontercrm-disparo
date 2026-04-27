"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";

type Stage = {
  id: string;
  name: string;
  position: number;
  category: "open" | "won" | "lost";
  color: string | null;
};
type Pipeline = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  active: boolean;
  stages: Stage[];
};

const CATEGORY_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-neutral-100 text-neutral-500"
};

export default function PipelinesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>("/pipelines")
  });

  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");

  const createPipelineMut = useMutation({
    mutationFn: () => api.post("/pipelines", { name: newPipelineName }),
    onSuccess: () => {
      setNewPipelineName("");
      setCreatingPipeline(false);
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    }
  });

  const deletePipelineMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pipelines/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] })
  });

  const setDefaultMut = useMutation({
    mutationFn: (id: string) => api.patch(`/pipelines/${id}/set-default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] })
  });

  if (isLoading) return <div className="max-w-3xl mx-auto p-6">Carregando…</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-semibold text-neutral-900">Funis (pipelines)</h1>
        <button
          onClick={() => setCreatingPipeline(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Novo funil
        </button>
      </div>

      {creatingPipeline && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <input
            value={newPipelineName}
            onChange={(e) => setNewPipelineName(e.target.value)}
            placeholder="Nome do funil"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => createPipelineMut.mutate()}
              disabled={!newPipelineName || createPipelineMut.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Criar
            </button>
            <button
              onClick={() => setCreatingPipeline(false)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {data?.pipelines.map((p) => (
        <PipelineCard
          key={p.id}
          pipeline={p}
          onSetDefault={() => setDefaultMut.mutate(p.id)}
          onDelete={() => {
            if (confirm("Remover funil?")) deletePipelineMut.mutate(p.id);
          }}
        />
      ))}
    </div>
  );
}

function PipelineCard({
  pipeline,
  onSetDefault,
  onDelete
}: {
  pipeline: Pipeline;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [stageName, setStageName] = useState("");
  const [stageCategory, setStageCategory] = useState<"open" | "won" | "lost">("open");

  const addStageMut = useMutation({
    mutationFn: () =>
      api.post(`/pipelines/${pipeline.id}/stages`, { name: stageName, category: stageCategory }),
    onSuccess: () => {
      setStageName("");
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    }
  });

  const deleteStageMut = useMutation({
    mutationFn: (stageId: string) => api.delete(`/pipelines/${pipeline.id}/stages/${stageId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] })
  });

  const moveStageMut = useMutation({
    mutationFn: ({ stageId, position }: { stageId: string; position: number }) =>
      api.patch(`/pipelines/${pipeline.id}/stages/${stageId}/move`, { position }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] })
  });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-900">{pipeline.name}</h2>
            {pipeline.isDefault && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                padrão
              </span>
            )}
          </div>
          {pipeline.description && (
            <p className="text-xs text-neutral-400 mt-0.5">{pipeline.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {!pipeline.isDefault && (
            <button
              onClick={onSetDefault}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
            >
              Tornar padrão
            </button>
          )}
          {!pipeline.isDefault && (
            <button
              onClick={onDelete}
              className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Excluir
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {pipeline.stages.map((s, idx) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">{s.position}.</span>
              <span className="text-sm text-neutral-700">{s.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[s.category]}`}>
                {s.category}
              </span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => moveStageMut.mutate({ stageId: s.id, position: Math.max(1, idx) })}
                disabled={idx === 0}
                className="px-2 text-xs text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
              >
                ↑
              </button>
              <button
                onClick={() => moveStageMut.mutate({ stageId: s.id, position: idx + 2 })}
                disabled={idx === pipeline.stages.length - 1}
                className="px-2 text-xs text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
              >
                ↓
              </button>
              <button
                onClick={() => {
                  if (confirm(`Remover stage "${s.name}"?`)) deleteStageMut.mutate(s.id);
                }}
                className="px-2 text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          </div>
        ))}

        {adding ? (
          <div className="flex gap-2">
            <input
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              placeholder="Nome do estágio"
              className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={stageCategory}
              onChange={(e) => setStageCategory(e.target.value as "open" | "won" | "lost")}
              className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm"
            >
              <option value="open">open</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
            </select>
            <button
              onClick={() => addStageMut.mutate()}
              disabled={!stageName || addStageMut.isPending}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Adicionar
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            + Novo estágio
          </button>
        )}
      </div>
    </div>
  );
}
