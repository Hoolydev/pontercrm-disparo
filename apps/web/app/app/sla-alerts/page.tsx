"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../lib/api";

type Alert = {
  id: string;
  hoursOverdue: number;
  alertedAt: string;
  lead: { id: string; name: string | null; phone: string; assignedBrokerId: string | null };
  stage: { id: string; name: string; slaHours: number; category: "open" | "won" | "lost" };
};

export default function SlaAlertsPage() {
  const [sinceHours, setSinceHours] = useState("168");

  const { data, isLoading } = useQuery({
    queryKey: ["sla-alerts", sinceHours],
    queryFn: () => api.get<{ alerts: Alert[] }>(`/sla-alerts?sinceHours=${sinceHours}`),
    refetchInterval: 60_000
  });

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Alertas de SLA</h1>
          <p className="text-xs text-neutral-400">Leads parados além do limite do estágio</p>
        </div>
        <select
          value={sinceHours}
          onChange={(e) => setSinceHours(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
        >
          <option value="24">Últimas 24h</option>
          <option value="72">Últimos 3 dias</option>
          <option value="168">Últimos 7 dias</option>
          <option value="720">Últimos 30 dias</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-3 text-left font-medium">Quando</th>
              <th className="px-3 py-3 text-left font-medium">Lead</th>
              <th className="px-3 py-3 text-left font-medium">Estágio</th>
              <th className="px-3 py-3 text-right font-medium">SLA</th>
              <th className="px-3 py-3 text-right font-medium">Atraso</th>
              <th className="px-3 py-3 text-left font-medium"></th>
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
            {!isLoading && !data?.alerts.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Nenhum alerta de SLA no período.
                </td>
              </tr>
            )}
            {data?.alerts.map((a) => (
              <tr key={a.id} className="hover:bg-neutral-50">
                <td className="px-3 py-3 text-neutral-500 text-[12px]">
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                  }).format(new Date(a.alertedAt))}
                </td>
                <td className="px-3 py-3">
                  <p className="text-neutral-700">{a.lead.name ?? "—"}</p>
                  <p className="text-[11px] text-neutral-400">{a.lead.phone}</p>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {a.stage.name}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-neutral-500">{a.stage.slaHours}h</td>
                <td className="px-3 py-3 text-right font-medium text-red-600">+{a.hoursOverdue}h</td>
                <td className="px-3 py-3">
                  <Link
                    href={`/app/leads/${a.lead.id}`}
                    className="text-xs text-pi-primary hover:underline"
                  >
                    Ver lead →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
