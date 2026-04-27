"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "../../../lib/api";

type Overview = {
  leads: { total: number; last24h: number };
  conversations: { total: number; aiActive: number; handedOff: number };
  messages: { last24h: number; ai: number; broker: number };
  handoffs: { last7d: number };
};

type CampaignMetrics = {
  campaigns: {
    id: string;
    name: string;
    status: "draft" | "active" | "paused" | "archived";
    campaignLeads: Record<string, number>;
    conversations: Record<string, number>;
    replyRate: number;
  }[];
};

type Agent = { id: string; name: string; type: "inbound" | "outbound"; model: string; active: boolean };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  active: "bg-pi-accent/15 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  archived: "bg-neutral-100 text-neutral-400"
};

export default function DashboardPage() {
  const overviewQuery = useQuery({
    queryKey: ["metrics-overview"],
    queryFn: () => api.get<Overview>("/metrics/overview"),
    refetchInterval: 30_000
  });
  const campaignsQuery = useQuery({
    queryKey: ["metrics-campaigns"],
    queryFn: () => api.get<CampaignMetrics>("/metrics/campaigns"),
    refetchInterval: 60_000
  });
  const agentsQuery = useQuery({
    queryKey: ["agents-summary"],
    queryFn: () => api.get<{ agents: Agent[] }>("/agents?active=true")
  });

  const ov = overviewQuery.data;
  const camps = campaignsQuery.data?.campaigns ?? [];
  const agents = agentsQuery.data?.agents ?? [];

  const totalDispatched = camps.reduce(
    (s, c) => s + ((c.campaignLeads.dispatched ?? 0) + (c.campaignLeads.replied ?? 0)),
    0
  );
  const totalReplied = camps.reduce((s, c) => s + (c.campaignLeads.replied ?? 0), 0);
  const overallReplyRate = totalDispatched > 0 ? totalReplied / totalDispatched : 0;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Dashboard</h1>
          <p className="text-xs text-neutral-400">Visão geral do dia · refresh a cada 30s</p>
        </div>
      </div>

      {/* KPIs */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Leads"
          value={ov?.leads.total ?? "—"}
          sub={ov ? `+${ov.leads.last24h} nas últimas 24h` : undefined}
          loading={overviewQuery.isLoading}
        />
        <KpiCard
          label="Conversas com IA"
          value={ov?.conversations.aiActive ?? "—"}
          sub={ov ? `${ov.conversations.handedOff} em handoff` : undefined}
          loading={overviewQuery.isLoading}
        />
        <KpiCard
          label="Mensagens 24h"
          value={ov?.messages.last24h ?? "—"}
          sub={ov ? `${ov.messages.ai} IA · ${ov.messages.broker} corretor` : undefined}
          loading={overviewQuery.isLoading}
        />
        <KpiCard
          label="Taxa de reply"
          value={`${(overallReplyRate * 100).toFixed(1)}%`}
          sub={`${totalReplied} de ${totalDispatched} disparos`}
          loading={campaignsQuery.isLoading}
        />
      </section>

      {/* Two-column layout */}
      <section className="grid gap-5 lg:grid-cols-3">
        {/* Campanhas ativas */}
        <div className="lg:col-span-2 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Campanhas</h2>
            <Link href="/app/campaigns" className="text-xs font-medium text-pi-primary hover:underline">
              Ver todas →
            </Link>
          </div>
          {campaignsQuery.isLoading ? (
            <p className="py-6 text-center text-xs text-neutral-400">Carregando…</p>
          ) : camps.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">Nenhuma campanha ainda.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-neutral-100">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">Campanha</th>
                    <th className="px-3 py-2.5 text-left font-medium">Status</th>
                    <th className="px-3 py-2.5 text-right font-medium">Pendentes</th>
                    <th className="px-3 py-2.5 text-right font-medium">Enviados</th>
                    <th className="px-3 py-2.5 text-right font-medium">Reply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {camps.slice(0, 6).map((c) => {
                    const sent = (c.campaignLeads.dispatched ?? 0) + (c.campaignLeads.replied ?? 0);
                    return (
                      <tr key={c.id} className="hover:bg-neutral-50">
                        <td className="px-3 py-3">
                          <Link
                            href={`/app/campaigns/${c.id}`}
                            className="text-sm font-medium text-neutral-800 hover:text-pi-primary"
                          >
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              STATUS_COLORS[c.status]
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-600">
                          {c.campaignLeads.pending ?? 0}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-600">{sent}</td>
                        <td className="px-3 py-3 text-right font-medium text-neutral-700">
                          {(c.replyRate * 100).toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Agentes ativos */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Agentes ativos</h2>
            <Link href="/app/agents" className="text-xs font-medium text-pi-primary hover:underline">
              Configurar
            </Link>
          </div>
          {agentsQuery.isLoading ? (
            <p className="py-6 text-center text-xs text-neutral-400">Carregando…</p>
          ) : agents.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">
              Nenhum agente. Crie um inbound + um outbound para iniciar.
            </p>
          ) : (
            <div className="space-y-2">
              {agents.slice(0, 6).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-[#fafbfc] px-3 py-2.5"
                >
                  <div className="flex h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500"></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">{a.name}</p>
                    <p className="text-[11px] text-neutral-400">
                      {a.type === "outbound" ? "Outbound" : "Inbound"} · {a.model}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Quick links */}
      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <QuickAction href="/app/campaigns" title="Iniciar campanha" sub="Disparo outbound em massa" emoji="🚀" />
        <QuickAction href="/app/inbox" title="Atender Inbox" sub="Conversas em andamento" emoji="💬" />
        <QuickAction href="/app/leads" title="Gestão de Leads" sub="Pipeline + filtros" emoji="👥" />
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  loading
}: {
  label: string;
  value: string | number;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">
        {loading ? "…" : value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-neutral-400">{sub}</p>}
    </div>
  );
}

function QuickAction({
  href,
  title,
  sub,
  emoji
}: {
  href: string;
  title: string;
  sub: string;
  emoji: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-pi-primary/30 hover:shadow-md transition-all"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pi-primary/10 text-lg">
        {emoji}
      </div>
      <div>
        <p className="text-sm font-semibold text-neutral-800 group-hover:text-pi-primary">{title}</p>
        <p className="text-[11px] text-neutral-400">{sub}</p>
      </div>
    </Link>
  );
}
