"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../lib/api";
import { useSession } from "../../../../lib/use-session";

type Stage = { id: string; name: string; category: "open" | "won" | "lost"; color: string | null };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };
type CampaignRow = { id: string; name: string; status: string };

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
  pipelineStage: { id: string; name: string; category: string; color: string | null } | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-neutral-100 text-neutral-500"
};

export default function LeadsPage() {
  const session = useSession();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageId, setStageId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [page, setPage] = useState(1);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>("/pipelines")
  });
  const defaultPipeline =
    pipelinesQuery.data?.pipelines.find((p) => p.isDefault) ?? pipelinesQuery.data?.pipelines[0];
  const stages = defaultPipeline?.stages ?? [];

  const campaignsQuery = useQuery({
    queryKey: ["campaigns-for-filter"],
    queryFn: () => api.get<{ campaigns: CampaignRow[] }>("/campaigns")
  });
  const campaigns = campaignsQuery.data?.campaigns ?? [];

  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (stageId) qs.set("stageId", stageId);
  if (campaignId) qs.set("campaignId", campaignId);
  qs.set("page", String(page));

  const { data, isLoading } = useQuery({
    queryKey: ["leads", search, stageId, campaignId, page],
    queryFn: () => api.get<{ leads: Lead[]; page: number }>(`/leads?${qs.toString()}`),
    placeholderData: (prev) => prev
  });

  const updateStage = useMutation({
    mutationFn: ({ id, newStageId }: { id: string; newStageId: string }) =>
      api.patch(`/leads/${id}/stage`, { stageId: newStageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] })
  });

  const canAssign =
    session !== "loading" && !!session && (session.role === "admin" || session.role === "supervisor");

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-800">Leads</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-400">{data?.leads.length ?? 0} resultados</span>
          <a
            href="/app/leads/kanban"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Ver Kanban →
          </a>
        </div>
      </div>

      <div className="mb-4 flex gap-3">
        <input
          type="search"
          placeholder="Buscar por nome, telefone, e-mail…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-64 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <select
          value={stageId}
          onChange={(e) => {
            setStageId(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        >
          <option value="">Todos os estágios</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={campaignId}
          onChange={(e) => {
            setCampaignId(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        >
          <option value="">Todas as campanhas</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Nome / Telefone</th>
              <th className="px-4 py-3 text-left font-medium">Origem</th>
              <th className="px-4 py-3 text-left font-medium">Corretor</th>
              <th className="px-4 py-3 text-left font-medium">Estágio</th>
              <th className="px-4 py-3 text-left font-medium">Entrada</th>
              <th className="px-4 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && !data?.leads.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Nenhum lead encontrado
                </td>
              </tr>
            )}
            {data?.leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-neutral-800">{lead.name ?? "—"}</p>
                  <p className="text-xs text-neutral-400">{lead.phone}</p>
                </td>
                <td className="px-4 py-3 text-neutral-500">{lead.source?.name ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {lead.assignedBroker?.displayName ?? <span className="text-neutral-300">Não atribuído</span>}
                </td>
                <td className="px-4 py-3">
                  {canAssign ? (
                    <select
                      value={lead.pipelineStage?.id ?? ""}
                      onChange={(e) => updateStage.mutate({ id: lead.id, newStageId: e.target.value })}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 outline-none cursor-pointer ${
                        CATEGORY_COLORS[lead.pipelineStage?.category ?? "open"] ?? "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        CATEGORY_COLORS[lead.pipelineStage?.category ?? "open"] ?? "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {lead.pipelineStage?.name ?? "—"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-400 text-xs">
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                  }).format(new Date(lead.createdAt))}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/app/leads/${lead.id}`} className="text-xs text-blue-600 hover:underline">
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data?.leads.length ?? 0) === 50 || page > 1 ? (
        <div className="mt-4 flex justify-center gap-2">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="px-3 py-1.5 text-sm text-neutral-500">p. {page}</span>
          <button
            disabled={(data?.leads.length ?? 0) < 50}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Próxima →
          </button>
        </div>
      ) : null}
    </div>
  );
}
