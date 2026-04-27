"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";

type Report = {
  kpis: {
    totalLeads: number;
    wonLeads: number;
    conversionRate: number;
    cpl: number;
    handoffsActive: number;
  };
  categoryDistribution: { category: string; n: number }[];
  weekly: { week: string; leads: number; won: number }[];
  bySource: {
    sourceId: string;
    sourceName: string;
    leads: number;
    won: number;
    conversionRate: number;
  }[];
  funnel: {
    stageId: string;
    stageName: string;
    position: number;
    category: string;
    leads: number;
  }[];
  agents: {
    agentId: string;
    agentName: string;
    type: string;
    conversations: number;
    messagesSent: number;
  }[];
};

export default function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-monthly"],
    queryFn: () => api.get<Report>("/reports/monthly"),
    refetchInterval: 60_000
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-neutral-400">Carregando relatórios…</div>;
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Relatórios</h1>
          <p className="text-xs text-neutral-400">Últimos 30 dias · refresh a cada 1min</p>
        </div>
        <button
          onClick={() => exportCsv(data)}
          className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Exportar CSV
        </button>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Leads (30d)" value={data.kpis.totalLeads} />
        <Kpi label="Ganhos (30d)" value={data.kpis.wonLeads} />
        <Kpi
          label="Taxa de conversão"
          value={`${(data.kpis.conversionRate * 100).toFixed(1)}%`}
          sub={`${data.kpis.wonLeads} de ${data.kpis.totalLeads}`}
        />
        <Kpi
          label="Em handoff"
          value={data.kpis.handoffsActive}
          sub="aguardando corretor"
        />
      </section>

      {/* Weekly bar chart */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Leads por semana (12 sem)</h2>
          <span className="text-[11px] text-neutral-400">azul=leads · verde=ganhos</span>
        </div>
        <BarChart weekly={data.weekly} />
      </section>

      {/* Two-column: Funnel + By source */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900 mb-4">Funil (pipeline padrão)</h2>
          <Funnel rows={data.funnel} />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900 mb-4">Por fonte de lead</h2>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="text-left font-medium pb-2">Fonte</th>
                <th className="text-right font-medium pb-2">Leads</th>
                <th className="text-right font-medium pb-2">Ganhos</th>
                <th className="text-right font-medium pb-2">Conversão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.bySource.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-xs text-neutral-400 py-6">
                    Sem fontes ainda.
                  </td>
                </tr>
              )}
              {data.bySource.map((s) => (
                <tr key={s.sourceId}>
                  <td className="py-2 text-neutral-700">{s.sourceName}</td>
                  <td className="py-2 text-right">{s.leads}</td>
                  <td className="py-2 text-right text-emerald-700">{s.won}</td>
                  <td className="py-2 text-right text-neutral-500">
                    {(s.conversionRate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Agents */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900 mb-4">Performance dos agentes</h2>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="text-left font-medium pb-2">Agente</th>
              <th className="text-left font-medium pb-2">Tipo</th>
              <th className="text-right font-medium pb-2">Conversas</th>
              <th className="text-right font-medium pb-2">Mensagens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {data.agents.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-xs text-neutral-400 py-6">
                  Nenhum agente ativo.
                </td>
              </tr>
            )}
            {data.agents.map((a) => (
              <tr key={a.agentId}>
                <td className="py-2 text-neutral-700">{a.agentName}</td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      a.type === "outbound"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {a.type}
                  </span>
                </td>
                <td className="py-2 text-right">{a.conversations}</td>
                <td className="py-2 text-right text-neutral-500">{a.messagesSent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-neutral-400">{sub}</p>}
    </div>
  );
}

function BarChart({ weekly }: { weekly: Report["weekly"] }) {
  const max = Math.max(...weekly.map((w) => Math.max(w.leads, w.won)), 1);
  const barW = 24;
  const gap = 12;
  const w = weekly.length * (barW * 2 + gap) + 20;
  return (
    <svg width="100%" height="160" viewBox={`0 0 ${w} 160`} className="overflow-visible">
      {weekly.map((row, i) => {
        const x = 10 + i * (barW * 2 + gap);
        const leadsH = (row.leads / max) * 120;
        const wonH = (row.won / max) * 120;
        return (
          <g key={row.week}>
            <rect x={x} y={140 - leadsH} width={barW} height={leadsH} fill="#157aff" rx={3} />
            <rect x={x + barW + 2} y={140 - wonH} width={barW} height={wonH} fill="#31ba96" rx={3} />
            <text
              x={x + barW}
              y={155}
              textAnchor="middle"
              fontSize={9}
              fill="#9ca3af"
              fontFamily="var(--font-poppins), sans-serif"
            >
              {fmtWeek(row.week)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Funnel({ rows }: { rows: Report["funnel"] }) {
  const max = Math.max(...rows.map((r) => r.leads), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = (r.leads / max) * 100;
        const color =
          r.category === "won"
            ? "#22c55e"
            : r.category === "lost"
              ? "#94a3b8"
              : "#157aff";
        return (
          <div key={r.stageId} className="flex items-center gap-3">
            <div className="w-32 text-xs text-neutral-700">{r.stageName}</div>
            <div className="flex-1 relative h-7 bg-neutral-50 rounded-lg overflow-hidden">
              <div
                className="h-full rounded-lg transition-all"
                style={{ width: `${pct}%`, background: color }}
              />
              <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-neutral-800">
                {r.leads}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function fmtWeek(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

function exportCsv(data: Report) {
  const lines: string[] = [];
  lines.push("# KPIs (30d)");
  lines.push("metric,value");
  lines.push(`total_leads,${data.kpis.totalLeads}`);
  lines.push(`won_leads,${data.kpis.wonLeads}`);
  lines.push(`conversion_rate,${data.kpis.conversionRate.toFixed(4)}`);
  lines.push(`handoffs_active,${data.kpis.handoffsActive}`);

  lines.push("");
  lines.push("# Weekly");
  lines.push("week,leads,won");
  for (const w of data.weekly) lines.push(`${w.week},${w.leads},${w.won}`);

  lines.push("");
  lines.push("# By source");
  lines.push("source,leads,won,conversion_rate");
  for (const s of data.bySource) {
    lines.push(
      `${csv(s.sourceName)},${s.leads},${s.won},${s.conversionRate.toFixed(4)}`
    );
  }

  lines.push("");
  lines.push("# Funnel");
  lines.push("position,stage,category,leads");
  for (const f of data.funnel) {
    lines.push(`${f.position},${csv(f.stageName)},${f.category},${f.leads}`);
  }

  lines.push("");
  lines.push("# Agents");
  lines.push("agent,type,conversations,messages_sent");
  for (const a of data.agents) {
    lines.push(`${csv(a.agentName)},${a.type},${a.conversations},${a.messagesSent}`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pointer-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csv(s: string): string {
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
