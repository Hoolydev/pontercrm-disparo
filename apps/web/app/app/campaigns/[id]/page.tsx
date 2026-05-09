"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../../../../lib/api";

type MetaTemplateParamSpec =
  | { source: "field"; field: "name" | "phone" | "propertyRef" | "origin" | "campaign"; name?: string }
  | { source: "literal"; value: string; name?: string };

type MetaTemplateHeaderSpec = {
  type: "video" | "image" | "document";
  source: "link" | "mediaId";
  value: string;
};

type CampaignDetail = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  firstMessageTemplate: string | null;
  metaTemplateName: string | null;
  metaTemplateLanguage: string | null;
  metaTemplateParamMap: MetaTemplateParamSpec[] | null;
  metaTemplateHeader: MetaTemplateHeaderSpec | null;
  settingsJson: {
    delay_range_ms?: [number, number];
    max_messages_per_minute?: number;
    min_seconds_between_messages_per_lead?: number;
    send_media?: boolean;
    business_hours?: { start: string; end: string; tz: string };
  };
  outboundAgent: { id: string; name: string; type: string } | null;
  inboundAgent: { id: string; name: string; type: string } | null;
  pipeline: { id: string; name: string };
  instances: { instance: { id: string; number: string; provider: string; status: string } }[];
};

type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category: string | null;
  bodyText: string | null;
  bodyParamCount: number;
  /** Names of body placeholders if the template uses named ({{nome}}). Null if positional. */
  bodyParamNames: string[] | null;
  /** "VIDEO" | "IMAGE" | "DOCUMENT" | "TEXT" | null. Drives header media input. */
  headerFormat: "VIDEO" | "IMAGE" | "DOCUMENT" | "TEXT" | null;
};

type Attachment = {
  id: string;
  kind: "image" | "video" | "document";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  caption: string | null;
};

type Instance = { id: string; number: string; provider: string; status: string; active: boolean };

const STATE_LABELS: Record<string, string> = {
  pending: "Pendente",
  queued: "Na fila",
  dispatched: "Enviado",
  replied: "Respondeu",
  failed: "Falhou",
  skipped: "Pulado"
};

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ["campaign", id],
    queryFn: () =>
      api.get<{ campaign: CampaignDetail; leadCounts: Record<string, number> }>(`/campaigns/${id}`)
  });

  const instancesQ = useQuery({
    queryKey: ["whatsapp-instances"],
    queryFn: () => api.get<{ instances: Instance[] }>("/whatsapp-instances")
  });

  const lifecycleMut = useMutation({
    mutationFn: (action: "start" | "pause" | "resume" | "archive") =>
      api.post(`/campaigns/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] })
  });

  const settingsMut = useMutation({
    mutationFn: (settingsJson: CampaignDetail["settingsJson"]) =>
      api.patch(`/campaigns/${id}`, { settingsJson }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] })
  });

  const attachInstanceMut = useMutation({
    mutationFn: (instanceId: string) => api.post(`/campaigns/${id}/instances`, { instanceId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] })
  });

  const detachInstanceMut = useMutation({
    mutationFn: (instanceId: string) => api.delete(`/campaigns/${id}/instances/${instanceId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] })
  });

  // First-message template
  const [tplDraft, setTplDraft] = useState<string | null>(null);
  const tplMut = useMutation({
    mutationFn: (firstMessageTemplate: string | null) =>
      api.patch(`/campaigns/${id}`, { firstMessageTemplate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] })
  });

  // Meta template (HSM) — pulled from the WhatsApp Manager via the first
  // Meta instance attached to this campaign. The campaign editor only
  // supports body-component templates; header/footer/buttons aren't
  // mapped (they fire with empty values and the template is rejected if
  // those slots are required).
  const metaInstanceId =
    detailQ.data?.campaign.instances.find(
      (ci) => ci.instance.provider === "meta"
    )?.instance.id ?? null;

  const metaTemplatesQ = useQuery({
    queryKey: ["meta-templates", metaInstanceId],
    enabled: !!metaInstanceId,
    queryFn: () =>
      api.get<{ templates: MetaTemplate[] }>(
        `/whatsapp-instances/${metaInstanceId}/meta-templates?status=APPROVED`
      )
  });

  const metaTplMut = useMutation({
    mutationFn: (payload: {
      metaTemplateName: string | null;
      metaTemplateLanguage: string | null;
      metaTemplateParamMap: MetaTemplateParamSpec[] | null;
      metaTemplateHeader: MetaTemplateHeaderSpec | null;
    }) => api.patch(`/campaigns/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] })
  });

  // Campaign attachments
  const attachmentsQ = useQuery({
    queryKey: ["campaign-attachments", id],
    queryFn: () => api.get<{ attachments: Attachment[] }>(`/campaigns/${id}/attachments`)
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const url =
        (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333") +
        `/campaigns/${id}/attachments`;
      const token =
        (typeof window !== "undefined" && localStorage.getItem("pointer_token")) || "";
      const res = await fetch(url, {
        method: "POST",
        body: fd,
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign-attachments", id] })
  });
  const deleteAttachment = useMutation({
    mutationFn: (attId: string) => api.delete(`/campaigns/${id}/attachments/${attId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign-attachments", id] })
  });

  const [leadIdsRaw, setLeadIdsRaw] = useState("");
  const addLeadsMut = useMutation({
    mutationFn: () => {
      const leadIds = leadIdsRaw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return api.post<{ inserted: number; skipped: number; requested: number }>(
        `/campaigns/${id}/leads`,
        { leadIds }
      );
    },
    onSuccess: () => {
      setLeadIdsRaw("");
      qc.invalidateQueries({ queryKey: ["campaign", id] });
    }
  });

  const csvInputRef = useRef<HTMLInputElement>(null);
  const csvImportMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const url =
        (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333") +
        `/campaigns/${id}/leads/import-csv`;
      const token =
        (typeof window !== "undefined" && localStorage.getItem("pointer_token")) || "";
      const res = await fetch(url, {
        method: "POST",
        body: fd,
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`import ${res.status}: ${t}`);
      }
      return res.json() as Promise<{
        rows: number;
        leadsCreated: number;
        attached: number;
        skipped: number;
        errors: Array<{ row: number; reason: string }>;
      }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] })
  });

  if (detailQ.isLoading)
    return (
      <div className="h-full overflow-y-auto p-6 text-sm text-neutral-400">Carregando…</div>
    );
  if (!detailQ.data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <p className="text-sm text-red-500">Campanha não encontrada.</p>
        <button onClick={() => router.push("/app/campaigns")} className="mt-3 text-sm text-blue-600">
          ← Voltar
        </button>
      </div>
    );
  }

  const camp = detailQ.data.campaign;
  const counts = detailQ.data.leadCounts;
  const attachedIds = new Set(camp.instances.map((i) => i.instance.id));
  const availableInstances = (instancesQ.data?.instances ?? []).filter((i) => i.active);
  const totalLeads = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/app/campaigns")} className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Campanhas
        </button>
        <span className="text-neutral-300">/</span>
        <span className="text-sm text-neutral-700">{camp.name}</span>
      </div>

      {/* Header card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{camp.name}</h1>
            <p className="text-xs text-neutral-400">
              Funil: {camp.pipeline.name}
              {camp.outboundAgent && ` · Outbound: ${camp.outboundAgent.name}`}
              {camp.inboundAgent && ` · Inbound: ${camp.inboundAgent.name}`}
            </p>
          </div>
          <StatusActions status={camp.status} onAction={(a) => lifecycleMut.mutate(a)} />
        </div>
      </div>

      {/* Lead counts */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
            Leads na campanha
          </h2>
          <span className="text-sm font-semibold text-neutral-900">
            Total: {totalLeads}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Object.entries(STATE_LABELS).map(([k, label]) => (
            <div key={k} className="rounded-lg bg-neutral-50 p-3">
              <p className="text-xs text-neutral-400">{label}</p>
              <p className="text-lg font-semibold text-neutral-900">{counts[k] ?? 0}</p>
            </div>
          ))}
        </div>
        {totalLeads > 0 && (
          <p className="mt-3 text-[11px] text-green-700">
            ✓ {totalLeads} leads anexados — persistido no banco. Reaparecem aqui ao recarregar
            a página.
          </p>
        )}
      </div>

      {/* Bulk add leads */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Adicionar leads à campanha
        </h2>

        {/* Spreadsheet import (preferred) */}
        <div className="mb-5 rounded-lg border border-dashed border-neutral-300 p-4">
          <p className="mb-2 text-xs font-semibold text-neutral-700">
            📊 Importar planilha (CSV / XLS / XLSX)
          </p>
          <p className="mb-3 text-[11px] text-neutral-500 leading-relaxed">
            Colunas reconhecidas: <code>Telefone</code> (obrigatório), <code>Nome</code>,{" "}
            <code>Email</code>, <code>Imovel</code>/<code>Codigo</code>, <code>Origem</code>.
            Variantes EN também: <code>phone</code>, <code>name</code>, <code>email</code>,{" "}
            <code>property_ref</code>, <code>origin</code>. Funciona com export do Superlogica
            e similares.
          </p>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) csvImportMut.mutate(f);
              e.target.value = "";
            }}
            className="hidden"
          />
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={csvImportMut.isPending}
            className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {csvImportMut.isPending ? "Importando…" : "Escolher arquivo"}
          </button>
          {csvImportMut.data && (
            <div className="mt-3 rounded-md bg-green-50 border border-green-200 p-2 text-xs text-green-800">
              <p>
                ✓ {csvImportMut.data.rows} linha(s) processada(s) · {csvImportMut.data.leadsCreated}{" "}
                leads disponíveis · {csvImportMut.data.attached} anexado(s) à campanha ·{" "}
                {csvImportMut.data.skipped} já existiam.
              </p>
              {csvImportMut.data.errors.length > 0 && (
                <p className="mt-1 text-amber-700">
                  ⚠️ {csvImportMut.data.errors.length} linha(s) com erro:{" "}
                  {csvImportMut.data.errors
                    .slice(0, 3)
                    .map((e) => `linha ${e.row} (${e.reason})`)
                    .join(", ")}
                  {csvImportMut.data.errors.length > 3 ? "…" : ""}
                </p>
              )}
            </div>
          )}
          {csvImportMut.isError && (
            <p className="mt-2 text-xs text-red-600">
              {csvImportMut.error instanceof Error
                ? csvImportMut.error.message
                : "erro ao importar"}
            </p>
          )}
        </div>

        {/* Bulk paste UUIDs (advanced) */}
        <details>
          <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800">
            Colar UUIDs de leads existentes (avançado)
          </summary>
          <textarea
            value={leadIdsRaw}
            onChange={(e) => setLeadIdsRaw(e.target.value)}
            rows={4}
            placeholder="Cole UUIDs de leads (separados por vírgula, espaço ou nova linha)"
            className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {addLeadsMut.data && (
            <p className="mt-2 text-xs text-green-700">
              Adicionados: {addLeadsMut.data.inserted} · Já existentes: {addLeadsMut.data.skipped}
            </p>
          )}
          <button
            onClick={() => addLeadsMut.mutate()}
            disabled={!leadIdsRaw.trim() || addLeadsMut.isPending}
            className="mt-3 rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-300 disabled:opacity-50"
          >
            {addLeadsMut.isPending ? "Enviando…" : "Adicionar UUIDs"}
          </button>
        </details>
      </div>

      {/* Instances */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Números de WhatsApp
        </h2>
        <div className="space-y-2">
          {camp.instances.map(({ instance: inst }) => (
            <div key={inst.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
              <div>
                <p className="text-sm text-neutral-700">{inst.number}</p>
                <p className="text-xs text-neutral-400">
                  {inst.provider} · {inst.status}
                </p>
              </div>
              <button
                onClick={() => detachInstanceMut.mutate(inst.id)}
                className="text-xs text-red-500 hover:underline"
              >
                Remover
              </button>
            </div>
          ))}
          {camp.instances.length === 0 && (
            <p className="text-xs text-neutral-400">Nenhum número anexado.</p>
          )}
        </div>
        <div className="mt-4 flex gap-2 flex-wrap">
          {availableInstances
            .filter((i) => !attachedIds.has(i.id))
            .map((i) => (
              <button
                key={i.id}
                onClick={() => attachInstanceMut.mutate(i.id)}
                className="rounded-full border border-neutral-200 px-3 py-1 text-xs hover:bg-neutral-50"
              >
                + {i.number}
              </button>
            ))}
        </div>
      </div>

      {/* First message template (outbound) */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Primeira mensagem (outbound)
        </h2>
        <p className="text-[11px] text-neutral-400 mb-3">
          Template enviado <strong>verbatim</strong> ao lead no primeiro toque (sem custo de
          LLM). Variáveis: <code>{"{{name}}"}</code>, <code>{"{{phone}}"}</code>,{" "}
          <code>{"{{property_ref}}"}</code>, <code>{"{{origin}}"}</code>,{" "}
          <code>{"{{campaign}}"}</code>. Quando o lead responder, a IA assume.
        </p>
        <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 leading-relaxed">
          ⚠️ <strong>Precedência:</strong> se o agente outbound (campo "Primeira mensagem" no
          editor do agente) tiver template próprio, o do agente <strong>vence</strong> sobre
          este. Útil quando o mesmo agente roda em campanhas diferentes com o mesmo texto, ou
          quando você quer texto diferente por campanha (use este aqui e deixe o do agente
          vazio).
        </div>
        <textarea
          value={tplDraft ?? camp.firstMessageTemplate ?? ""}
          onChange={(e) => setTplDraft(e.target.value)}
          rows={4}
          placeholder="Olá {{name}}! Vi que você se interessou pelo {{property_ref}}. Posso te mandar mais detalhes?"
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              const value = tplDraft ?? camp.firstMessageTemplate ?? "";
              tplMut.mutate(value.trim() ? value : null);
              setTplDraft(null);
            }}
            disabled={tplMut.isPending}
            className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {tplMut.isPending ? "Salvando…" : "Salvar template"}
          </button>
          {(camp.firstMessageTemplate || tplDraft) && (
            <button
              onClick={() => {
                tplMut.mutate(null);
                setTplDraft(null);
              }}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Limpar (deixar IA gerar)
            </button>
          )}
        </div>
      </div>

      {/* Meta-approved template (HSM) */}
      <MetaTemplateSection
        camp={camp}
        metaInstanceId={metaInstanceId}
        templates={metaTemplatesQ.data?.templates ?? []}
        loading={metaTemplatesQ.isLoading}
        error={metaTemplatesQ.error}
        onSave={(payload) => metaTplMut.mutate(payload)}
        saving={metaTplMut.isPending}
      />

      {/* Campaign attachments */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Anexos da campanha
        </h2>
        <p className="text-[11px] text-neutral-400 mb-3">
          Materiais que a IA pode mencionar/referenciar nesta campanha (catálogo, brochura, vídeo
          institucional). Diferente dos imóveis individuais (Captação).
        </p>
        <div className="space-y-2 mb-3">
          {(attachmentsQ.data?.attachments ?? []).length === 0 && (
            <p className="text-xs text-neutral-400 py-2">Nenhum anexo na campanha.</p>
          )}
          {attachmentsQ.data?.attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-100 px-3 py-2"
            >
              <span className="text-base">
                {a.kind === "image" ? "🖼️" : a.kind === "video" ? "🎬" : "📄"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-neutral-700 truncate">{a.filename}</p>
                <p className="text-[10px] text-neutral-400">
                  {(a.sizeBytes / 1024).toFixed(0)} KB · {a.mimeType}
                </p>
              </div>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-pi-primary hover:underline"
              >
                Abrir
              </a>
              <button
                onClick={() => {
                  if (confirm("Remover anexo?")) deleteAttachment.mutate(a.id);
                }}
                className="text-[11px] text-red-500 hover:underline"
              >
                Remover
              </button>
            </div>
          ))}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,application/pdf,application/msword,.docx"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadAttachment.mutate(f);
            e.target.value = "";
          }}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadAttachment.isPending}
          className="rounded-lg border border-dashed border-pi-primary/50 px-4 py-3 text-sm font-medium text-pi-primary hover:bg-pi-primary/5 w-full disabled:opacity-50"
        >
          {uploadAttachment.isPending ? "Enviando…" : "+ Adicionar arquivo"}
        </button>
      </div>

      {/* Settings */}
      <SettingsCard
        camp={camp}
        onSave={(s) => settingsMut.mutate(s)}
        saving={settingsMut.isPending}
      />
      </div>
    </div>
  );
}

function StatusActions({
  status,
  onAction
}: {
  status: CampaignDetail["status"];
  onAction: (a: "start" | "pause" | "resume" | "archive") => void;
}) {
  return (
    <div className="flex gap-2">
      {status === "draft" && (
        <button
          onClick={() => onAction("start")}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          Iniciar disparo
        </button>
      )}
      {status === "active" && (
        <button
          onClick={() => onAction("pause")}
          className="rounded-lg border border-yellow-300 px-3 py-1.5 text-xs font-medium text-yellow-700 hover:bg-yellow-50"
        >
          Pausar
        </button>
      )}
      {status === "paused" && (
        <button
          onClick={() => onAction("resume")}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          Retomar
        </button>
      )}
      {status !== "archived" && (
        <button
          onClick={() => onAction("archive")}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Arquivar
        </button>
      )}
    </div>
  );
}

function SettingsCard({
  camp,
  onSave,
  saving
}: {
  camp: CampaignDetail;
  onSave: (s: CampaignDetail["settingsJson"]) => void;
  saving: boolean;
}) {
  const [delayMin, setDelayMin] = useState(
    Math.round((camp.settingsJson.delay_range_ms?.[0] ?? 8000) / 1000)
  );
  const [delayMax, setDelayMax] = useState(
    Math.round((camp.settingsJson.delay_range_ms?.[1] ?? 15000) / 1000)
  );
  const [mpm, setMpm] = useState(camp.settingsJson.max_messages_per_minute ?? 20);
  const [minPerLead, setMinPerLead] = useState(
    camp.settingsJson.min_seconds_between_messages_per_lead ?? 0
  );
  const [sendMedia, setSendMedia] = useState(camp.settingsJson.send_media ?? false);
  const [bhStart, setBhStart] = useState(camp.settingsJson.business_hours?.start ?? "");
  const [bhEnd, setBhEnd] = useState(camp.settingsJson.business_hours?.end ?? "");
  const [bhTz, setBhTz] = useState(camp.settingsJson.business_hours?.tz ?? "America/Sao_Paulo");

  function save() {
    const settings: CampaignDetail["settingsJson"] = {
      delay_range_ms: [delayMin * 1000, delayMax * 1000],
      max_messages_per_minute: mpm,
      min_seconds_between_messages_per_lead: minPerLead,
      send_media: sendMedia
    };
    if (bhStart && bhEnd) {
      settings.business_hours = { start: bhStart, end: bhEnd, tz: bhTz };
    }
    onSave(settings);
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
        Configurações de disparo
      </h2>
      <p className="text-[11px] text-neutral-400 mb-3">
        Delays e limites anti-ban — sobrescrevem o que está no agente quando ele atua nesta
        campanha.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Delay min: ${delayMin}s`} hint="Tempo mínimo de digitação simulada">
          <input
            type="range"
            min="0"
            max="60"
            step="1"
            value={delayMin}
            onChange={(e) => setDelayMin(Math.min(Number(e.target.value), delayMax))}
            className="w-full"
          />
        </Field>
        <Field label={`Delay max: ${delayMax}s`} hint="Tempo máximo de digitação simulada">
          <input
            type="range"
            min="0"
            max="60"
            step="1"
            value={delayMax}
            onChange={(e) => setDelayMax(Math.max(Number(e.target.value), delayMin))}
            className="w-full"
          />
        </Field>
        <Field label={`Msgs/min (campanha): ${mpm}`} hint="Limite global de envios da campanha">
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={mpm}
            onChange={(e) => setMpm(Number(e.target.value))}
            className="w-full"
          />
        </Field>
        <Field
          label={`Mín entre msgs/lead: ${minPerLead}s`}
          hint="Anti-spam: tempo mínimo entre msgs ao MESMO lead"
        >
          <input
            type="range"
            min="0"
            max="600"
            step="10"
            value={minPerLead}
            onChange={(e) => setMinPerLead(Number(e.target.value))}
            className="w-full"
          />
        </Field>
        <Field label="Enviar mídia">
          <select
            value={sendMedia ? "true" : "false"}
            onChange={(e) => setSendMedia(e.target.value === "true")}
            className="input"
          >
            <option value="false">Não</option>
            <option value="true">Sim</option>
          </select>
        </Field>
        <Field label="Horário comercial — início (HH:MM)">
          <input
            value={bhStart}
            onChange={(e) => setBhStart(e.target.value)}
            placeholder="09:00"
            className="input"
          />
        </Field>
        <Field label="Horário comercial — fim (HH:MM)">
          <input
            value={bhEnd}
            onChange={(e) => setBhEnd(e.target.value)}
            placeholder="20:00"
            className="input"
          />
        </Field>
        <Field label="Timezone (IANA)">
          <input value={bhTz} onChange={(e) => setBhTz(e.target.value)} className="input" />
        </Field>
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar configurações"}
      </button>
      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: none;
          box-shadow: 0 0 0 2px #3b82f6;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}

const FIELD_OPTIONS: Array<{
  value: "name" | "phone" | "propertyRef" | "origin" | "campaign";
  label: string;
}> = [
  { value: "name", label: "Nome do lead" },
  { value: "phone", label: "Telefone" },
  { value: "propertyRef", label: "Referência do imóvel" },
  { value: "origin", label: "Origem" },
  { value: "campaign", label: "Nome da campanha" }
];

function MetaTemplateSection({
  camp,
  metaInstanceId,
  templates,
  loading,
  error,
  onSave,
  saving
}: {
  camp: CampaignDetail;
  metaInstanceId: string | null;
  templates: MetaTemplate[];
  loading: boolean;
  error: unknown;
  onSave: (payload: {
    metaTemplateName: string | null;
    metaTemplateLanguage: string | null;
    metaTemplateParamMap: MetaTemplateParamSpec[] | null;
    metaTemplateHeader: MetaTemplateHeaderSpec | null;
  }) => void;
  saving: boolean;
}) {
  // The "selected template" is identified by name+language. We keep the
  // dropdown's value as a JSON-encoded {name,language} so React can compare
  // by string.
  const currentKey =
    camp.metaTemplateName && camp.metaTemplateLanguage
      ? JSON.stringify({ name: camp.metaTemplateName, language: camp.metaTemplateLanguage })
      : "";
  const [draftKey, setDraftKey] = useState<string>(currentKey);
  const [draftMap, setDraftMap] = useState<MetaTemplateParamSpec[] | null>(
    camp.metaTemplateParamMap ?? null
  );
  const [draftHeader, setDraftHeader] = useState<MetaTemplateHeaderSpec | null>(
    camp.metaTemplateHeader ?? null
  );

  const selected = (() => {
    if (!draftKey) return null;
    try {
      const { name, language } = JSON.parse(draftKey);
      return templates.find((t) => t.name === name && t.language === language) ?? null;
    } catch {
      return null;
    }
  })();

  // Re-sync local draft when the campaign or selected template changes.
  const expectedSlots = selected?.bodyParamCount ?? 0;
  const placeholderNames = selected?.bodyParamNames ?? null;
  const map = draftMap ?? camp.metaTemplateParamMap ?? [];

  // Header media is required ONLY when the template's HEADER is non-text.
  const headerKind: "video" | "image" | "document" | null = (() => {
    switch (selected?.headerFormat) {
      case "VIDEO": return "video";
      case "IMAGE": return "image";
      case "DOCUMENT": return "document";
      default: return null;
    }
  })();

  function ensureMapLength(target: number): MetaTemplateParamSpec[] {
    const next = [...map];
    while (next.length < target) {
      next.push({ source: "field", field: "name" });
    }
    next.length = target;
    // Stamp `name` from the template's named placeholders so the worker
    // sends `parameter_name`. For positional templates this stays undefined.
    if (placeholderNames) {
      for (let i = 0; i < next.length; i++) {
        next[i] = { ...next[i], name: placeholderNames[i] };
      }
    }
    return next;
  }

  function updateSlot(idx: number, spec: MetaTemplateParamSpec) {
    const next = ensureMapLength(expectedSlots);
    next[idx] = placeholderNames ? { ...spec, name: placeholderNames[idx] } : spec;
    setDraftMap(next);
  }

  if (!metaInstanceId) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Template Meta (HSM oficial)
        </h2>
        <p className="text-[11px] text-neutral-400">
          Esta campanha não tem nenhuma instância <strong>Meta Cloud API</strong>{" "}
          atrelada. Adicione uma instância Meta na seção de instâncias acima
          para configurar um template oficial.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
        Template Meta (HSM oficial)
      </h2>
      <p className="text-[11px] text-neutral-400 mb-3">
        Lista os templates <strong>aprovados</strong> no WhatsApp Manager.
        Quando configurado, o primeiro disparo outbound de cada lead vai como{" "}
        <code>type: "template"</code> — obrigatório fora da janela de 24h.
        Crie templates novos diretamente no Meta Business Manager.
      </p>

      {loading && <p className="text-xs text-neutral-400">Carregando templates…</p>}
      {Boolean(error) && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">
          Erro ao buscar templates da Meta:{" "}
          {error instanceof Error ? error.message : "desconhecido"}
        </div>
      )}

      {!loading && !error && templates.length === 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
          Nenhum template <strong>aprovado</strong> nesta WABA. Crie e aguarde
          aprovação no Meta Business Manager → WhatsApp → Message Templates.
        </div>
      )}

      {!loading && !error && templates.length > 0 && (
        <div className="space-y-3">
          <Field
            label="Template aprovado"
            hint="Nome · idioma (categoria) — só listamos os APROVADOS"
          >
            <select
              value={draftKey}
              onChange={(e) => {
                setDraftKey(e.target.value);
                setDraftMap(null);
              }}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
            >
              <option value="">— Não usar template Meta —</option>
              {templates.map((t) => (
                <option
                  key={`${t.name}::${t.language}`}
                  value={JSON.stringify({ name: t.name, language: t.language })}
                >
                  {t.name} · {t.language}
                  {t.category ? ` (${t.category})` : ""}
                </option>
              ))}
            </select>
          </Field>

          {selected?.bodyText && (
            <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-[11px] text-neutral-700 font-mono whitespace-pre-wrap">
              {selected.bodyText}
            </div>
          )}

          {selected && headerKind && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[11px] font-medium text-amber-900">
                Header de {headerKind} obrigatório
              </p>
              <p className="text-[10px] text-amber-700">
                A Meta exige a mídia do header para enviar este template. Use{" "}
                <strong>media_id</strong> (mais confiável — recomendado fazer
                upload no Meta via <code>POST /media</code> e colar o id) ou um{" "}
                <strong>link público HTTPS</strong> (Meta CDN tenta baixar; URLs
                de hotlink, ex.: <code>scontent.whatsapp.net</code>, podem
                falhar silenciosamente).
              </p>
              <div className="flex gap-2">
                <select
                  value={draftHeader?.source ?? "link"}
                  onChange={(e) =>
                    setDraftHeader({
                      type: headerKind,
                      source: e.target.value as "link" | "mediaId",
                      value: draftHeader?.value ?? ""
                    })
                  }
                  className="rounded-lg border border-amber-300 px-2 py-1.5 text-xs"
                >
                  <option value="link">Link (URL pública)</option>
                  <option value="mediaId">media_id (upload Meta)</option>
                </select>
                <input
                  value={draftHeader?.value ?? ""}
                  onChange={(e) =>
                    setDraftHeader({
                      type: headerKind,
                      source: draftHeader?.source ?? "link",
                      value: e.target.value
                    })
                  }
                  placeholder={
                    draftHeader?.source === "mediaId"
                      ? "1666620241334804"
                      : "https://exemplo.com/video.mp4"
                  }
                  className="flex-1 rounded-lg border border-amber-300 px-2 py-1.5 text-xs font-mono"
                />
              </div>
            </div>
          )}

          {selected && expectedSlots > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-neutral-600">
                Mapear parâmetros (
                {expectedSlots === 1 ? "1 slot" : `${expectedSlots} slots`})
                {placeholderNames && (
                  <span className="ml-1 text-[10px] text-emerald-700">
                    · template usa placeholders nomeados
                  </span>
                )}
                :
              </p>
              {Array.from({ length: expectedSlots }).map((_, idx) => {
                const slotMap = ensureMapLength(expectedSlots);
                const spec = slotMap[idx];
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-500 w-16 font-mono">
                      {placeholderNames
                        ? `{{${placeholderNames[idx]}}}`
                        : `{{${idx + 1}}}`}
                    </span>
                    <select
                      value={spec.source}
                      onChange={(e) => {
                        const src = e.target.value as "field" | "literal";
                        if (src === "literal") {
                          updateSlot(idx, { source: "literal", value: "" });
                        } else {
                          updateSlot(idx, { source: "field", field: "name" });
                        }
                      }}
                      className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
                    >
                      <option value="field">Campo do lead</option>
                      <option value="literal">Texto fixo</option>
                    </select>
                    {spec.source === "field" ? (
                      <select
                        value={spec.field}
                        onChange={(e) =>
                          updateSlot(idx, {
                            source: "field",
                            field: e.target.value as MetaTemplateParamSpec extends {
                              source: "field";
                              field: infer F;
                            }
                              ? F
                              : never
                          })
                        }
                        className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
                      >
                        {FIELD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={spec.value}
                        onChange={(e) =>
                          updateSlot(idx, { source: "literal", value: e.target.value })
                        }
                        placeholder="Texto fixo"
                        className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <button
              disabled={saving}
              onClick={() => {
                if (!draftKey) {
                  onSave({
                    metaTemplateName: null,
                    metaTemplateLanguage: null,
                    metaTemplateParamMap: null,
                    metaTemplateHeader: null
                  });
                  return;
                }
                if (!selected) return;
                onSave({
                  metaTemplateName: selected.name,
                  metaTemplateLanguage: selected.language,
                  metaTemplateParamMap: ensureMapLength(expectedSlots),
                  metaTemplateHeader:
                    headerKind && draftHeader?.value
                      ? {
                          type: headerKind,
                          source: draftHeader.source,
                          value: draftHeader.value
                        }
                      : null
                });
              }}
              className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar template Meta"}
            </button>
            {camp.metaTemplateName && (
              <button
                onClick={() => {
                  setDraftKey("");
                  setDraftMap(null);
                  setDraftHeader(null);
                  onSave({
                    metaTemplateName: null,
                    metaTemplateLanguage: null,
                    metaTemplateParamMap: null,
                    metaTemplateHeader: null
                  });
                }}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                Remover
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
