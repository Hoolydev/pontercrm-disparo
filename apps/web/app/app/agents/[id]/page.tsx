"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LLM_MODELS } from "@pointer/shared/llm-models";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import {
  OutboundFlow,
  type Attachment as FlowAttachment,
  type CampaignSummary
} from "../../../../components/agent/OutboundFlow";

type Agent = {
  id: string;
  name: string;
  type: "inbound" | "outbound";
  model: string;
  systemPrompt: string;
  behaviorJson: AgentBehavior;
  firstMessage: string | null;
  handoffAgentId: string | null;
  active: boolean;
};

type AgentBehavior = {
  temperature?: number;
  max_tokens?: number;
  max_history_messages?: number;
  delay_range_ms?: [number, number];
  summarize_after_messages?: number;
  tools_enabled?: string[];
};

type Attachment = {
  id: string;
  kind: "image" | "video" | "document";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  caption: string | null;
  createdAt: string;
};

type AgentRow = {
  id: string;
  name: string;
  type: "inbound" | "outbound";
};

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  outboundAgentId: string | null;
  inboundAgentId: string | null;
  instanceIds: string[];
};

type PlaygroundMessage = { role: "user" | "assistant"; content: string };

const SUGGESTED_PROMPTS = [
  "Oi, vi o anúncio do apartamento. Ainda está disponível?",
  "Quanto é o aluguel do apto na Vila Mariana?",
  "Posso visitar amanhã às 15h?",
  "Tem garagem? Aceitam pet?"
];

const ALL_TOOLS: Array<{ id: string; label: string; hint: string }> = [
  {
    id: "transfer_to_broker",
    label: "Transferir ao corretor",
    hint: "Pausa IA e direciona conversa pra um corretor humano"
  },
  {
    id: "schedule_visit",
    label: "Agendar visita",
    hint: "Cria appointment + cascata handoff (urgência alta)"
  },
  {
    id: "update_stage",
    label: "Mover lead no funil",
    hint: "IA atualiza estágio (Novo → Em conversa → Qualificado…)"
  },
  {
    id: "send_property",
    label: "Enviar imóvel (PDF)",
    hint: "IA envia ficha de um imóvel do catálogo (foto + descrição em PDF)"
  }
];

export default function AgentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: agentData, isLoading } = useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<{ agent: Agent }>(`/agents/${id}`)
  });
  const data = agentData?.agent;

  const attachmentsQuery = useQuery({
    queryKey: ["agent-attachments", id],
    queryFn: () => api.get<{ attachments: Attachment[] }>(`/agents/${id}/attachments`)
  });

  const inboundAgentsQuery = useQuery({
    queryKey: ["agents", "inbound"],
    queryFn: () => api.get<{ agents: AgentRow[] }>(`/agents?type=inbound&active=true`)
  });

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<{ campaigns: CampaignRow[] }>(`/campaigns`)
  });

  const whatsappInstancesQuery = useQuery({
    queryKey: ["whatsapp-instances"],
    queryFn: () =>
      api.get<{
        instances: Array<{
          id: string;
          number: string;
          provider: string;
          status: string;
          active: boolean;
        }>;
      }>(`/whatsapp-instances`)
  });

  const [mutError, setMutError] = useState<string | null>(null);

  const linkAgentToCampaignMut = useMutation({
    mutationFn: ({ campaignId, role }: { campaignId: string; role: "outbound" | "inbound" }) =>
      api.patch(`/campaigns/${campaignId}`, {
        [role === "outbound" ? "outboundAgentId" : "inboundAgentId"]: id
      }),
    onSuccess: () => {
      setMutError(null);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: unknown) => setMutError(e instanceof Error ? e.message : "erro ao vincular")
  });

  const unlinkAgentFromCampaignMut = useMutation({
    mutationFn: ({ campaignId, role }: { campaignId: string; role: "outbound" | "inbound" }) =>
      api.patch(`/campaigns/${campaignId}`, {
        [role === "outbound" ? "outboundAgentId" : "inboundAgentId"]: null
      }),
    onSuccess: () => {
      setMutError(null);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: unknown) => setMutError(e instanceof Error ? e.message : "erro ao desvincular")
  });

  type CampaignsResponse = { campaigns: CampaignRow[] };
  const campaignsKey = ["campaigns"];

  function patchCampaignInstances(
    campaignId: string,
    transform: (ids: string[]) => string[]
  ) {
    qc.setQueriesData<CampaignsResponse>({ queryKey: campaignsKey }, (old) => {
      if (!old) return old;
      return {
        ...old,
        campaigns: old.campaigns.map((c) =>
          c.id === campaignId
            ? { ...c, instanceIds: transform(c.instanceIds ?? []) }
            : c
        )
      };
    });
  }

  const attachInstanceToCampaignMut = useMutation({
    mutationFn: ({
      campaignId,
      instanceId
    }: {
      campaignId: string;
      instanceId: string;
    }) => api.post(`/campaigns/${campaignId}/instances`, { instanceId }),
    onMutate: async ({ campaignId, instanceId }) => {
      await qc.cancelQueries({ queryKey: campaignsKey });
      const snapshot = qc.getQueriesData<CampaignsResponse>({ queryKey: campaignsKey });
      patchCampaignInstances(campaignId, (ids) =>
        ids.includes(instanceId) ? ids : [...ids, instanceId]
      );
      return { snapshot };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      setMutError(e instanceof Error ? e.message : "erro ao anexar instância");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: campaignsKey });
    }
  });

  const detachInstanceFromCampaignMut = useMutation({
    mutationFn: ({
      campaignId,
      instanceId
    }: {
      campaignId: string;
      instanceId: string;
    }) => api.delete(`/campaigns/${campaignId}/instances/${instanceId}`),
    onMutate: async ({ campaignId, instanceId }) => {
      await qc.cancelQueries({ queryKey: campaignsKey });
      const snapshot = qc.getQueriesData<CampaignsResponse>({ queryKey: campaignsKey });
      patchCampaignInstances(campaignId, (ids) => ids.filter((x) => x !== instanceId));
      return { snapshot };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      setMutError(e instanceof Error ? e.message : "erro ao remover instância");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: campaignsKey });
    }
  });

  const [name, setName] = useState("");
  const [type, setType] = useState<"inbound" | "outbound">("inbound");
  const [model, setModel] = useState("gpt-5-mini");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [handoffAgentId, setHandoffAgentId] = useState<string>("");

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [maxHistoryMessages, setMaxHistoryMessages] = useState(20);
  const [summarizeAfter, setSummarizeAfter] = useState(40);
  const [delayMin, setDelayMin] = useState(8);
  const [delayMax, setDelayMax] = useState(15);
  const [toolsEnabled, setToolsEnabled] = useState<string[]>([]);

  const [playMessages, setPlayMessages] = useState<PlaygroundMessage[]>([]);
  const [playInput, setPlayInput] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setType(data.type);
    setModel(data.model);
    setSystemPrompt(data.systemPrompt);
    setFirstMessage(data.firstMessage ?? "");
    setHandoffAgentId(data.handoffAgentId ?? "");
    const b = data.behaviorJson ?? {};
    setTemperature(b.temperature ?? 0.7);
    setMaxTokens(b.max_tokens ?? 500);
    setMaxHistoryMessages(b.max_history_messages ?? 20);
    setSummarizeAfter(b.summarize_after_messages ?? 40);
    if (b.delay_range_ms) {
      setDelayMin(Math.round(b.delay_range_ms[0] / 1000));
      setDelayMax(Math.round(b.delay_range_ms[1] / 1000));
    }
    setToolsEnabled(b.tools_enabled ?? ALL_TOOLS.map((t) => t.id));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const behavior: AgentBehavior = {
        temperature,
        max_tokens: maxTokens,
        max_history_messages: maxHistoryMessages,
        summarize_after_messages: summarizeAfter,
        delay_range_ms: [delayMin * 1000, delayMax * 1000],
        tools_enabled: toolsEnabled
      };
      return api.patch(`/agents/${id}`, {
        name,
        type,
        model,
        systemPrompt,
        behaviorJson: behavior,
        firstMessage: firstMessage.trim() || null,
        handoffAgentId: handoffAgentId || null
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", id] });
    }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const url =
        (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333") +
        `/agents/${id}/attachments`;
      const token =
        (typeof window !== "undefined" && localStorage.getItem("pointer_token")) || "";
      const res = await fetch(url, {
        method: "POST",
        body: fd,
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`upload ${res.status}: ${t}`);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-attachments", id] })
  });
  const deleteAttachmentMutation = useMutation({
    mutationFn: (attId: string) => api.delete(`/agents/${id}/attachments/${attId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-attachments", id] })
  });

  // ALL campaigns (for the Lead source / WhatsApps editors). instanceIds now
  // come straight from the campaigns list — no per-campaign GET needed.
  const allCampaigns = useMemo(() => campaignsQuery.data?.campaigns ?? [], [campaignsQuery.data]);

  const campaignsForFlow: CampaignSummary[] = useMemo(
    () =>
      allCampaigns.map((c) => {
        const isOutbound = c.outboundAgentId === id;
        const isInbound = c.inboundAgentId === id;
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          isOutbound,
          isInbound,
          instanceIds: c.instanceIds ?? [],
          instanceCount: (c.instanceIds ?? []).length
        };
      }),
    [allCampaigns, id]
  );

  function toggleTool(toolId: string) {
    setToolsEnabled((cur) =>
      cur.includes(toolId) ? cur.filter((t) => t !== toolId) : [...cur, toolId]
    );
  }

  async function playground(textOverride?: string) {
    const text = (textOverride ?? playInput).trim();
    if (!text) return;
    const userMsg: PlaygroundMessage = { role: "user", content: text };
    const msgs = [...playMessages, userMsg];
    setPlayMessages(msgs);
    setPlayInput("");
    setIsPlaying(true);
    try {
      const res = await api.post<{ content: string }>(`/agents/${id}/playground`, {
        messages: msgs
      });
      setPlayMessages([...msgs, { role: "assistant", content: res.content ?? "[sem resposta]" }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro";
      setPlayMessages([...msgs, { role: "assistant", content: `[Erro: ${msg}]` }]);
    } finally {
      setIsPlaying(false);
    }
  }

  const inboundAgents = inboundAgentsQuery.data?.agents ?? [];
  const handoffAgent = useMemo(
    () => inboundAgents.find((a) => a.id === handoffAgentId) ?? null,
    [inboundAgents, handoffAgentId]
  );
  const attachments = attachmentsQuery.data?.attachments ?? [];

  const flowAttachments: FlowAttachment[] = attachments.map((a) => ({
    id: a.id,
    kind: a.kind,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    url: a.url
  }));

  if (isLoading || !agentData)
    return <div className="p-6 text-sm text-neutral-400">Carregando…</div>;
  if (!data) return <div className="p-6 text-sm text-red-500">Agente não encontrado.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/agents")}
            className="text-sm text-neutral-500 hover:text-neutral-800"
          >
            ← Voltar
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-0 text-base font-semibold text-neutral-900 focus:outline-none focus:ring-0"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "inbound" | "outbound")}
            className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs"
          >
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saveMutation.isPending ? "Salvando…" : "Salvar"}
        </button>
      </div>

      {saveMutation.isError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-xs text-red-600 flex-shrink-0">
          {saveMutation.error?.message}
        </div>
      )}
      {mutError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-xs text-red-600 flex-shrink-0 flex items-center justify-between">
          <span>{mutError}</span>
          <button onClick={() => setMutError(null)} className="text-red-500 hover:text-red-800">
            ×
          </button>
        </div>
      )}
      {type === "outbound" && (
        <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 text-xs text-blue-700 flex-shrink-0">
          ℹ️ Outbound dispara a primeira mensagem (template) + anexos. Quando o lead responde,
          a conversa é automaticamente transferida para o <strong>agente inbound</strong>{" "}
          configurado, que faz qualificação e usa todas as tools. Clique nos nós à direita para
          editar.
        </div>
      )}

      {/* Hidden file input for attachment uploads — used by both flow editor and inbound side panel */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,application/pdf,application/msword,.docx"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadMutation.mutate(f);
          e.target.value = "";
        }}
        className="hidden"
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-1/2 flex-col border-r border-neutral-200 overflow-y-auto">
          <div className="p-5 space-y-6">
            <Section title="Modelo & parâmetros">
              <Field label="Modelo">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="input"
                >
                  {Object.entries(groupByFamily()).map(([family, items]) => (
                    <optgroup key={family} label={family}>
                      {items.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {m.tier === "mini"
                            ? " · mini"
                            : m.tier === "nano"
                              ? " · nano"
                              : m.tier === "reasoning"
                                ? " · reasoning"
                                : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ModelHint id={model} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={`Temperature: ${temperature.toFixed(2)}`}
                  hint="0 = determinístico · 1 = criativo"
                >
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>
                <Field label={`Max tokens: ${maxTokens}`} hint="Limite por resposta">
                  <input
                    type="range"
                    min="100"
                    max="2000"
                    step="50"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>
              </div>
            </Section>

            <Section title="System prompt" hint="Personalidade, regras, objetivos do agente">
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={10}
                className="input font-mono text-sm leading-relaxed"
              />
            </Section>

            <Section title="Memória" hint="Histórico contextual + resumo">
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Histórico: ${maxHistoryMessages} msgs`} hint="Msgs no contexto">
                  <input
                    type="range"
                    min="5"
                    max="50"
                    step="1"
                    value={maxHistoryMessages}
                    onChange={(e) => setMaxHistoryMessages(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>
                <Field
                  label={`Resumir após: ${summarizeAfter} msgs`}
                  hint="Comprime histórico"
                >
                  <input
                    type="range"
                    min="20"
                    max="100"
                    step="5"
                    value={summarizeAfter}
                    onChange={(e) => setSummarizeAfter(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>
              </div>
            </Section>

            <Section title="Ações disponíveis (tools)" hint="O que o agente pode executar">
              <div className="space-y-2">
                {ALL_TOOLS.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      toolsEnabled.includes(t.id)
                        ? "border-pi-primary bg-pi-primary/5"
                        : "border-neutral-200 hover:bg-neutral-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={toolsEnabled.includes(t.id)}
                      onChange={() => toggleTool(t.id)}
                      className="mt-0.5 accent-pi-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-800">{t.label}</p>
                      <p className="text-[11px] text-neutral-500">{t.hint}</p>
                      <code className="text-[10px] text-neutral-400">{t.id}</code>
                    </div>
                  </label>
                ))}
              </div>
            </Section>

            {/* Inbound-only: attachments live on the left (no flow). Outbound has them in the flow. */}
            {type === "inbound" && (
              <Section
                title="Anexos do agente"
                hint="PDFs, vídeos, imagens — agente referencia quando relevante"
              >
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) uploadMutation.mutate(f);
                  }}
                  className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                    dragOver
                      ? "border-pi-primary bg-pi-primary/10"
                      : "border-neutral-300 hover:border-pi-primary hover:bg-pi-primary/5"
                  } ${uploadMutation.isPending ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <div className="text-3xl mb-2">📎</div>
                  <p className="text-sm font-medium text-neutral-700">
                    {uploadMutation.isPending
                      ? "Enviando…"
                      : "Arraste um arquivo aqui ou clique para escolher"}
                  </p>
                  <p className="text-[11px] text-neutral-400 mt-1">
                    PDF, imagem, vídeo, doc — até 25MB
                  </p>
                </div>
                {uploadMutation.isError && (
                  <p className="mt-2 text-[11px] text-red-500">
                    {uploadMutation.error?.message}
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {attachments.length === 0 && (
                    <p className="text-[11px] text-neutral-400 py-1">Nenhum anexo ainda.</p>
                  )}
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2"
                    >
                      <span className="text-base">{kindEmoji(a.kind)}</span>
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
                          if (confirm("Remover anexo?")) deleteAttachmentMutation.mutate(a.id);
                        }}
                        className="text-[11px] text-red-500 hover:underline"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>

        {/* Right panel: Flow for outbound, Playground for inbound */}
        {type === "outbound" ? (
          <div className="flex w-1/2 flex-col overflow-hidden bg-neutral-50">
            <div className="border-b border-neutral-200 bg-white px-4 py-3 flex-shrink-0">
              <h3 className="text-sm font-semibold text-neutral-800">Fluxo do outbound</h3>
              <p className="text-[11px] text-neutral-400">
                Clique em qualquer nó pra editar. As mudanças salvam quando você clica em
                "Salvar" no topo.
              </p>
            </div>
            <div className="flex-1 min-h-0">
              <OutboundFlow
                firstMessage={firstMessage}
                attachments={flowAttachments}
                handoffAgent={handoffAgent}
                handoffTools={
                  handoffAgent
                    ? ALL_TOOLS.filter((t) => toolsEnabled.includes(t.id)).map((t) => t.label)
                    : []
                }
                inboundAgents={inboundAgents}
                campaigns={campaignsForFlow}
                whatsappInstances={whatsappInstancesQuery.data?.instances ?? []}
                delayMin={delayMin}
                delayMax={delayMax}
                setFirstMessage={setFirstMessage}
                setHandoffAgentId={setHandoffAgentId}
                setDelayMin={setDelayMin}
                setDelayMax={setDelayMax}
                onUploadClick={() => fileInputRef.current?.click()}
                onDeleteAttachment={(attId) => deleteAttachmentMutation.mutate(attId)}
                onLinkCampaign={(campaignId, role) =>
                  linkAgentToCampaignMut.mutate({ campaignId, role })
                }
                onUnlinkCampaign={(campaignId, role) =>
                  unlinkAgentFromCampaignMut.mutate({ campaignId, role })
                }
                onAttachInstance={(campaignId, instanceId) =>
                  attachInstanceToCampaignMut.mutate({ campaignId, instanceId })
                }
                onDetachInstance={(campaignId, instanceId) =>
                  detachInstanceFromCampaignMut.mutate({ campaignId, instanceId })
                }
              />
            </div>
          </div>
        ) : (
          <div className="flex w-1/2 flex-col overflow-hidden bg-neutral-50">
            <div className="border-b border-neutral-200 bg-white px-4 py-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-800">Playground</h3>
                  <p className="text-[11px] text-neutral-400">
                    Simule uma conversa com o agente — não persiste no banco
                  </p>
                </div>
                {playMessages.length > 0 && (
                  <button
                    onClick={() => setPlayMessages([])}
                    className="text-xs text-neutral-400 hover:text-neutral-700"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3">
              {playMessages.length === 0 && (
                <div className="pt-6">
                  <p className="text-center text-sm text-neutral-500 mb-4">
                    💬 Comece uma conversa de teste
                  </p>
                  <p className="text-center text-[11px] text-neutral-400 mb-3">
                    Sugestões para começar:
                  </p>
                  <div className="flex flex-col gap-2 max-w-sm mx-auto">
                    {SUGGESTED_PROMPTS.map((sug) => (
                      <button
                        key={sug}
                        onClick={() => playground(sug)}
                        disabled={isPlaying}
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs text-neutral-700 hover:border-pi-primary hover:bg-pi-primary/5 disabled:opacity-50"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {playMessages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-4 py-3 text-sm max-w-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "ml-auto bg-pi-primary text-white"
                      : "bg-white border border-neutral-200 text-neutral-800"
                  }`}
                >
                  {m.content}
                </div>
              ))}
              {isPlaying && (
                <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-400 max-w-sm">
                  Digitando…
                </div>
              )}
            </div>

            <div className="border-t border-neutral-200 bg-white p-3 flex-shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  value={playInput}
                  onChange={(e) => setPlayInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      playground();
                    }
                  }}
                  placeholder="Digite uma mensagem como se fosse o lead… (Enter envia, Shift+Enter quebra linha)"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
                />
                <button
                  onClick={() => playground()}
                  disabled={isPlaying || !playInput.trim()}
                  className="rounded-lg bg-pi-primary px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
        .input:focus {
          box-shadow: 0 0 0 2px rgba(21, 122, 255, 0.25);
          border-color: rgba(21, 122, 255, 0.5);
        }
      `}</style>
    </div>
  );
}

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5">
        <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
          {title}
        </h3>
        {hint && <p className="text-[11px] text-neutral-400 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function ModelHint({ id }: { id: string }) {
  const m = LLM_MODELS.find((x) => x.id === id);
  if (!m?.hint) return null;
  return <p className="mt-1 text-[10px] text-neutral-400">{m.hint}</p>;
}

function groupByFamily(): Record<string, typeof LLM_MODELS> {
  const out: Record<string, typeof LLM_MODELS> = {};
  for (const m of LLM_MODELS) {
    if (!out[m.family]) out[m.family] = [];
    out[m.family]!.push(m);
  }
  return out;
}

function kindEmoji(kind: string): string {
  if (kind === "image") return "🖼️";
  if (kind === "video") return "🎬";
  return "📄";
}
