"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";

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

const CATEGORY_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-50 text-red-600"
};
const CONV_STATUS_COLORS: Record<string, string> = {
  ai_active: "bg-green-100 text-green-700",
  handed_off: "bg-orange-100 text-orange-700",
  closed: "bg-neutral-100 text-neutral-500"
};

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: leadData, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => api.get<{ lead: Lead }>(`/leads/${id}`)
  });
  const lead = leadData?.lead;

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>("/pipelines")
  });
  const stages =
    (pipelinesQuery.data?.pipelines.find((p) => p.isDefault) ?? pipelinesQuery.data?.pipelines[0])
      ?.stages ?? [];

  const stageMutation = useMutation({
    mutationFn: (stageId: string) => api.patch(`/leads/${id}/stage`, { stageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead", id] })
  });

  if (isLoading) return <div className="p-6 text-sm text-neutral-400">Carregando…</div>;
  if (!lead) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-500">Lead não encontrado.</p>
        <button onClick={() => router.push("/app/leads")} className="mt-3 text-sm text-blue-600">
          ← Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/app/leads")} className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Leads
        </button>
        <span className="text-neutral-300">/</span>
        <span className="text-sm text-neutral-700">{lead.name ?? lead.phone}</span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{lead.name ?? "Sem nome"}</h1>
            <p className="text-sm text-neutral-400">{lead.phone}</p>
            {lead.email && <p className="text-sm text-neutral-400">{lead.email}</p>}
          </div>
          <select
            value={lead.pipelineStage?.id ?? ""}
            onChange={(e) => stageMutation.mutate(e.target.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 focus:outline-none ${
              CATEGORY_COLORS[lead.pipelineStage?.category ?? "open"] ?? "bg-neutral-100 text-neutral-500"
            }`}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          {lead.origin && (
            <Detail label="Origem" value={lead.origin} />
          )}
          {lead.propertyRef && <Detail label="Imóvel" value={lead.propertyRef} />}
          {lead.source && <Detail label="Fonte" value={lead.source.name} />}
          {lead.assignedBroker && <Detail label="Corretor" value={lead.assignedBroker.displayName} />}
          <Detail label="Criado em" value={new Date(lead.createdAt).toLocaleDateString("pt-BR")} />
        </div>
      </div>

      <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
        Conversas ({lead.conversations.length})
      </h2>
      <div className="space-y-2">
        {lead.conversations.map((conv) => (
          <Link
            key={conv.id}
            href={`/app/inbox/${conv.id}`}
            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:bg-neutral-50 transition-colors"
          >
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    CONV_STATUS_COLORS[conv.status] ?? "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {conv.status === "ai_active" ? "IA ativa" : conv.status === "handed_off" ? "Com corretor" : "Fechada"}
                </span>
                {conv.aiPaused && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-600">
                    IA pausada
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {conv.lastMessageAt
                  ? `Última msg: ${new Date(conv.lastMessageAt).toLocaleString("pt-BR")}`
                  : `Criada: ${new Date(conv.createdAt).toLocaleString("pt-BR")}`}
              </p>
            </div>
            <span className="text-xs text-blue-500">Abrir →</span>
          </Link>
        ))}
        {lead.conversations.length === 0 && (
          <p className="text-center text-sm text-neutral-400 py-8">Nenhuma conversa para este lead.</p>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="text-neutral-700">{value}</p>
    </div>
  );
}
