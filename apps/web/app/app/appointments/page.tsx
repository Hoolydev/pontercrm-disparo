"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../lib/api";

type Appointment = {
  id: string;
  scheduledFor: string;
  address: string | null;
  notes: string | null;
  status: "scheduled" | "confirmed" | "done" | "cancelled" | "no_show";
  source: "ai_tool" | "manual";
  lead: { id: string; name: string | null; phone: string };
  broker: { id: string; displayName: string } | null;
  conversation: { id: string; status: string } | null;
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  done: "Realizada",
  cancelled: "Cancelada",
  no_show: "Não compareceu"
};
const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  confirmed: "bg-purple-100 text-purple-700",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-neutral-100 text-neutral-500",
  no_show: "bg-red-100 text-red-700"
};

export default function AppointmentsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["appointments", statusFilter],
    queryFn: () => {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      return api.get<{ appointments: Appointment[] }>(`/appointments${qs}`);
    }
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/appointments/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appointments"] })
  });

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Agendamentos</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Quando</th>
              <th className="px-4 py-3 text-left font-medium">Lead</th>
              <th className="px-4 py-3 text-left font-medium">Corretor</th>
              <th className="px-4 py-3 text-left font-medium">Endereço</th>
              <th className="px-4 py-3 text-left font-medium">Origem</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium"></th>
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
            {!isLoading && !data?.appointments.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                  Nenhum agendamento.
                </td>
              </tr>
            )}
            {data?.appointments.map((a) => (
              <tr key={a.id} className="hover:bg-neutral-50">
                <td className="px-4 py-3 text-neutral-700">
                  {new Date(a.scheduledFor).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </td>
                <td className="px-4 py-3">
                  <p className="text-neutral-700">{a.lead.name ?? "—"}</p>
                  <p className="text-xs text-neutral-400">{a.lead.phone}</p>
                </td>
                <td className="px-4 py-3 text-neutral-500">
                  {a.broker?.displayName ?? <span className="text-neutral-300">—</span>}
                </td>
                <td className="px-4 py-3 text-neutral-500 max-w-xs truncate">{a.address ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-neutral-400">
                  {a.source === "ai_tool" ? "IA" : "Manual"}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={a.status}
                    onChange={(e) => updateStatus.mutate({ id: a.id, status: e.target.value })}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 cursor-pointer ${
                      STATUS_COLORS[a.status]
                    }`}
                  >
                    {Object.entries(STATUS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  {a.conversation && (
                    <Link href={`/app/inbox/${a.conversation.id}`} className="text-xs text-blue-600 hover:underline">
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
