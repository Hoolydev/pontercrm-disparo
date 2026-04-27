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
    createdAt: string;
    campaignLeads: Record<string, number>;
    conversations: Record<string, number>;
    replyRate: number;
  }[];
};

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  archived: "bg-neutral-100 text-neutral-400"
};

type BrokerMetrics = {
  brokers: {
    id: string;
    displayName: string;
    active: boolean;
    activeConversations: number;
    totalConversations: number;
  }[];
};

type InstanceMetrics = {
  instances: {
    id: string;
    provider: string;
    number: string;
    status: string;
    messagesSentLastMinute: number;
    rateLimitPerMinute: number;
    active: boolean;
  }[];
};

function StatCard({
  label,
  value,
  sub
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}

export default function MetricsPage() {
  const { data: overview, isLoading: loadingOv } = useQuery({
    queryKey: ["metrics-overview"],
    queryFn: () => api.get<Overview>("/metrics/overview"),
    refetchInterval: 30_000
  });

  const { data: brokers, isLoading: loadingBrokers } = useQuery({
    queryKey: ["metrics-brokers"],
    queryFn: () => api.get<BrokerMetrics>("/metrics/brokers"),
    refetchInterval: 30_000
  });

  const { data: instances, isLoading: loadingInst } = useQuery({
    queryKey: ["metrics-instances"],
    queryFn: () => api.get<InstanceMetrics>("/metrics/instances"),
    refetchInterval: 30_000
  });

  const { data: campaignMetrics, isLoading: loadingCamps } = useQuery({
    queryKey: ["metrics-campaigns"],
    queryFn: () => api.get<CampaignMetrics>("/metrics/campaigns"),
    refetchInterval: 30_000
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-lg font-semibold text-neutral-900">Métricas</h1>

      {/* Overview */}
      {loadingOv ? (
        <p className="text-sm text-neutral-400">Carregando…</p>
      ) : overview ? (
        <>
          <section>
            <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              Leads
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Total" value={overview.leads.total} />
              <StatCard label="Novos 24h" value={overview.leads.last24h} />
              <StatCard label="Conversas ativas (IA)" value={overview.conversations.aiActive} />
              <StatCard
                label="Em handoff"
                value={overview.conversations.handedOff}
                sub="aguardando corretor"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              Mensagens (últimas 24h)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Total msgs" value={overview.messages.last24h} />
              <StatCard label="Msgs IA" value={overview.messages.ai} />
              <StatCard label="Msgs corretor" value={overview.messages.broker} />
              <StatCard
                label="Handoffs 7d"
                value={overview.handoffs.last7d}
                sub="conversas transferidas"
              />
            </div>
          </section>
        </>
      ) : null}

      {/* Campaigns */}
      <section>
        <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Campanhas
        </h2>
        {loadingCamps ? (
          <p className="text-sm text-neutral-400">Carregando…</p>
        ) : !campaignMetrics?.campaigns.length ? (
          <p className="text-sm text-neutral-400">Nenhuma campanha ainda.</p>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100">
                <tr>
                  {[
                    "Campanha",
                    "Status",
                    "Pendentes",
                    "Na fila",
                    "Enviados",
                    "Responderam",
                    "Taxa reply",
                    "Em handoff"
                  ].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-neutral-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {campaignMetrics.campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">
                      <Link href={`/app/campaigns/${c.id}`} className="hover:text-blue-600">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          CAMPAIGN_STATUS_COLORS[c.status]
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{c.campaignLeads.pending ?? 0}</td>
                    <td className="px-4 py-3 text-neutral-600">{c.campaignLeads.queued ?? 0}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {(c.campaignLeads.dispatched ?? 0) + (c.campaignLeads.replied ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{c.campaignLeads.replied ?? 0}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {(c.replyRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {c.conversations.handed_off ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Brokers */}
      <section>
        <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Corretores
        </h2>
        {loadingBrokers ? (
          <p className="text-sm text-neutral-400">Carregando…</p>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100">
                <tr>
                  {["Nome", "Conversas ativas", "Total conversas", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-neutral-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {brokers?.brokers.map((b) => (
                  <tr key={b.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">{b.displayName}</td>
                    <td className="px-4 py-3 text-neutral-600">{b.activeConversations}</td>
                    <td className="px-4 py-3 text-neutral-400">{b.totalConversations}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          b.active
                            ? "bg-green-100 text-green-700"
                            : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {b.active ? "ativo" : "inativo"}
                      </span>
                    </td>
                  </tr>
                ))}
                {!brokers?.brokers.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-xs text-neutral-400">
                      Nenhum corretor
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Instances */}
      <section>
        <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Instâncias WhatsApp
        </h2>
        {loadingInst ? (
          <p className="text-sm text-neutral-400">Carregando…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {instances?.instances.map((inst) => (
              <div
                key={inst.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{inst.number}</p>
                    <p className="text-xs text-neutral-400 capitalize">{inst.provider}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      inst.status === "connected"
                        ? "bg-green-100 text-green-700"
                        : inst.status === "banned"
                        ? "bg-red-200 text-red-800"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {inst.status}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-neutral-500 mb-1">
                    <span>Taxa msgs/min</span>
                    <span>
                      {inst.messagesSentLastMinute}/{inst.rateLimitPerMinute}
                    </span>
                  </div>
                  <div className="bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (inst.messagesSentLastMinute / inst.rateLimitPerMinute) * 100)}%`
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {!instances?.instances.length && (
              <p className="text-sm text-neutral-400 col-span-3">Nenhuma instância configurada.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
