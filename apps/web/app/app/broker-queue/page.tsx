"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../lib/api";

type Entry = {
  id: string;
  status: "pending" | "accepted" | "timeout" | "reassigned";
  priorityHint: "low" | "normal" | "high" | null;
  assignedAt: string;
  timeoutAt: string;
  respondedAt: string | null;
  attempts: number;
  reason: string | null;
  lead: { id: string; name: string | null; phone: string };
  broker: { id: string; displayName: string };
  conversation: { id: string; status: string } | null;
};

type Stats = {
  byStatus: Record<string, number>;
  pendingByBroker: Record<string, number>;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  timeout: "bg-red-100 text-red-700",
  reassigned: "bg-amber-100 text-amber-700"
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  normal: "bg-neutral-100 text-neutral-500",
  low: "bg-neutral-50 text-neutral-400"
};

export default function BrokerQueuePage() {
  const [statusFilter, setStatusFilter] = useState("");
  const qs = new URLSearchParams();
  if (statusFilter) qs.set("status", statusFilter);

  const { data, isLoading } = useQuery({
    queryKey: ["broker-queue", statusFilter],
    queryFn: () => api.get<{ entries: Entry[] }>(`/broker-queue?${qs.toString()}`),
    refetchInterval: 30_000
  });

  const statsQuery = useQuery({
    queryKey: ["broker-queue-stats"],
    queryFn: () => api.get<Stats>("/broker-queue/stats"),
    refetchInterval: 30_000
  });

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Fila de Corretores</h1>
          <p className="text-xs text-neutral-400">Estado dos handoffs · refresh a cada 30s</p>
        </div>
      </div>

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["pending", "accepted", "timeout", "reassigned"] as const).map((s) => (
          <div key={s} className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
            <p
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold ${
                STATUS_COLORS[s]
              }`}
            >
              {s}
            </p>
            <p className="mt-1.5 text-xl font-semibold text-neutral-900">
              {statsQuery.data?.byStatus[s] ?? 0}
            </p>
          </div>
        ))}
      </section>

      <div className="mb-4 flex gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
        >
          <option value="">Todos os status</option>
          <option value="pending">Pendentes (aguardando aceite)</option>
          <option value="accepted">Aceitos</option>
          <option value="timeout">Timeout</option>
          <option value="reassigned">Reatribuídos</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-3 text-left font-medium">Atribuído</th>
              <th className="px-3 py-3 text-left font-medium">Lead</th>
              <th className="px-3 py-3 text-left font-medium">Corretor</th>
              <th className="px-3 py-3 text-left font-medium">Prioridade</th>
              <th className="px-3 py-3 text-left font-medium">Timeout</th>
              <th className="px-3 py-3 text-left font-medium">Tentativa</th>
              <th className="px-3 py-3 text-left font-medium">Status</th>
              <th className="px-3 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-neutral-400">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && !data?.entries.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-neutral-400">
                  Fila vazia.
                </td>
              </tr>
            )}
            {data?.entries.map((e) => (
              <tr key={e.id} className="hover:bg-neutral-50">
                <td className="px-3 py-3 text-neutral-500 text-[12px]">
                  {fmtDateTime(e.assignedAt)}
                </td>
                <td className="px-3 py-3">
                  <p className="text-neutral-700">{e.lead.name ?? "—"}</p>
                  <p className="text-[11px] text-neutral-400">{e.lead.phone}</p>
                </td>
                <td className="px-3 py-3 text-neutral-500">{e.broker.displayName}</td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      PRIORITY_COLORS[e.priorityHint ?? "normal"]
                    }`}
                  >
                    {e.priorityHint ?? "normal"}
                  </span>
                </td>
                <td className="px-3 py-3 text-neutral-500 text-[12px]">
                  {e.status === "pending" ? <Countdown until={e.timeoutAt} /> : fmtDateTime(e.timeoutAt)}
                </td>
                <td className="px-3 py-3 text-neutral-500">#{e.attempts}</td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[e.status]
                    }`}
                  >
                    {e.status}
                  </span>
                </td>
                <td className="px-3 py-3">
                  {e.conversation && (
                    <Link
                      href={`/app/inbox/${e.conversation.id}`}
                      className="text-xs text-pi-primary hover:underline"
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

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function Countdown({ until }: { until: string }) {
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return <span className="text-red-500">vencido</span>;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return (
    <span className={min < 2 ? "text-amber-600 font-medium" : "text-neutral-500"}>
      {min}m {String(sec).padStart(2, "0")}s
    </span>
  );
}
