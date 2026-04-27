"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../lib/api";

type Followup = {
  id: string;
  step: "broker_30min" | "broker_24h" | "broker_48h" | "broker_5d" | "redistribute_15d";
  status: "pending" | "sent" | "skipped" | "done" | "cancelled";
  scheduledFor: string;
  triggerEvent: string | null;
  resultJson: Record<string, unknown> | null;
  createdAt: string;
  lead: { id: string; name: string | null; phone: string };
  broker: { id: string; displayName: string } | null;
  conversation: { id: string; status: string } | null;
  campaign: { id: string; name: string } | null;
};

const STEP_LABELS: Record<string, string> = {
  broker_30min: "Cobrança +30min",
  broker_24h: "Cobrança +24h",
  broker_48h: "Cobrança +48h",
  broker_5d: "Cobrança +5d",
  redistribute_15d: "Redistribuição +15d"
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-blue-100 text-blue-700",
  sent: "bg-green-100 text-green-700",
  skipped: "bg-neutral-100 text-neutral-500",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-100 text-neutral-400"
};

export default function FollowupsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [stepFilter, setStepFilter] = useState("");

  const qs = new URLSearchParams();
  if (statusFilter) qs.set("status", statusFilter);
  if (stepFilter) qs.set("step", stepFilter);

  const { data, isLoading } = useQuery({
    queryKey: ["followups", statusFilter, stepFilter],
    queryFn: () => api.get<{ followups: Followup[] }>(`/followups?${qs.toString()}`),
    refetchInterval: 30_000
  });

  const statsQuery = useQuery({
    queryKey: ["followups-stats"],
    queryFn: () => api.get<{ byStatus: Record<string, number>; byStep: Record<string, number> }>("/followups/stats"),
    refetchInterval: 30_000
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.post(`/followups/${id}/cancel`, { reason: "manual_ui" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followups"] });
      qc.invalidateQueries({ queryKey: ["followups-stats"] });
    }
  });

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Cobranças</h1>
          <p className="text-xs text-neutral-400">Follow-up automático ao corretor — refresh a cada 30s</p>
        </div>
      </div>

      {/* Stats */}
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["pending", "sent", "done", "cancelled", "skipped"] as const).map((s) => (
          <StatCard
            key={s}
            label={s}
            value={statsQuery.data?.byStatus[s] ?? 0}
            color={STATUS_COLORS[s]}
          />
        ))}
      </section>

      {/* Filters */}
      <div className="mb-4 flex gap-3 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
        >
          <option value="">Todos os status</option>
          <option value="pending">Pendente</option>
          <option value="sent">Enviado</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelado</option>
          <option value="skipped">Pulado</option>
        </select>
        <select
          value={stepFilter}
          onChange={(e) => setStepFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
        >
          <option value="">Todos os steps</option>
          {Object.entries(STEP_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-3 text-left font-medium">Step</th>
              <th className="px-3 py-3 text-left font-medium">Lead</th>
              <th className="px-3 py-3 text-left font-medium">Corretor</th>
              <th className="px-3 py-3 text-left font-medium">Quando</th>
              <th className="px-3 py-3 text-left font-medium">Origem</th>
              <th className="px-3 py-3 text-left font-medium">Status</th>
              <th className="px-3 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && !data?.followups.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                  Nenhuma cobrança no filtro atual.
                </td>
              </tr>
            )}
            {data?.followups.map((f) => (
              <tr key={f.id} className="hover:bg-neutral-50">
                <td className="px-3 py-3 font-medium text-neutral-700">
                  {STEP_LABELS[f.step] ?? f.step}
                </td>
                <td className="px-3 py-3">
                  <p className="text-neutral-700">{f.lead.name ?? "—"}</p>
                  <p className="text-[11px] text-neutral-400">{f.lead.phone}</p>
                </td>
                <td className="px-3 py-3 text-neutral-500">
                  {f.broker?.displayName ?? <span className="text-neutral-300">—</span>}
                </td>
                <td className="px-3 py-3 text-neutral-500 text-[12px]">
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                  }).format(new Date(f.scheduledFor))}
                </td>
                <td className="px-3 py-3 text-neutral-500 text-xs">
                  {f.campaign ? (
                    <Link href={`/app/campaigns/${f.campaign.id}`} className="hover:text-pi-primary">
                      {f.campaign.name}
                    </Link>
                  ) : (
                    f.triggerEvent ?? "—"
                  )}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[f.status] ?? "bg-neutral-100"
                    }`}
                  >
                    {f.status}
                  </span>
                </td>
                <td className="px-3 py-3">
                  {f.status === "pending" && (
                    <button
                      onClick={() => {
                        if (confirm("Cancelar esta cobrança?")) cancelMut.mutate(f.id);
                      }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Cancelar
                    </button>
                  )}
                  {f.conversation && (
                    <Link
                      href={`/app/inbox/${f.conversation.id}`}
                      className="ml-2 text-xs text-pi-primary hover:underline"
                    >
                      Conversa →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      <p className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold ${color ?? "bg-neutral-100 text-neutral-500"}`}>
        {label}
      </p>
      <p className="mt-1.5 text-xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}
