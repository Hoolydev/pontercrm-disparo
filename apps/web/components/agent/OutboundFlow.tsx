"use client";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";

type AgentRow = { id: string; name: string };

export type Attachment = {
  id: string;
  kind: "image" | "video" | "document";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

export type WhatsAppInstance = {
  id: string;
  number: string;
  provider: string;
  status: string;
  active: boolean;
};

export type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  /** True when this agent is the campaign's outbound agent. */
  isOutbound: boolean;
  /** True when this agent is the campaign's inbound agent. */
  isInbound: boolean;
  /** WhatsApp instance IDs attached to the campaign (only populated for linked campaigns). */
  instanceIds: string[];
  instanceCount?: number;
};

type Props = {
  // Read state
  firstMessage: string;
  attachments: Attachment[];
  handoffAgent: AgentRow | null;
  handoffTools: string[];
  inboundAgents: AgentRow[];
  campaigns: CampaignSummary[];
  whatsappInstances: WhatsAppInstance[];
  delayMin: number;
  delayMax: number;

  // Setters
  setFirstMessage: (v: string) => void;
  setHandoffAgentId: (v: string) => void;
  setDelayMin: (v: number) => void;
  setDelayMax: (v: number) => void;

  // Callbacks
  onUploadClick: () => void;
  onDeleteAttachment: (id: string) => void;
  onLinkCampaign: (campaignId: string, role: "outbound" | "inbound") => void;
  onUnlinkCampaign: (campaignId: string, role: "outbound" | "inbound") => void;
  onAttachInstance: (campaignId: string, instanceId: string) => void;
  onDetachInstance: (campaignId: string, instanceId: string) => void;
};

type NodeId = "start" | "first-msg" | "attachments" | "whatsapps" | "wait" | "handoff";

type StartNodeData = { campaigns: CampaignSummary[]; selected: boolean };
type FirstMessageNodeData = { text: string; selected: boolean };
type AttachmentsNodeData = { count: number; selected: boolean };
type WhatsAppsNodeData = { campaigns: CampaignSummary[]; selected: boolean };
type WaitNodeData = { min: number; max: number; selected: boolean };
type HandoffNodeData = { agent: AgentRow | null; tools: string[]; selected: boolean };

const StartNode = ({ data }: NodeProps<Node<StartNodeData>>) => (
  <NodeShell color="green" icon="📋" selected={data.selected}>
    <Handle type="source" position={Position.Bottom} />
    <p className="text-[11px] font-semibold text-green-700">Lead source</p>
    <p className="text-[10px] text-neutral-600">
      {data.campaigns.length === 0
        ? "Nenhuma campanha"
        : `${data.campaigns.length} campanha(s) ativa(s)`}
    </p>
    <p className="text-[9px] italic text-neutral-400 mt-0.5">clique para configurar</p>
  </NodeShell>
);

const FirstMessageNode = ({ data }: NodeProps<Node<FirstMessageNodeData>>) => (
  <NodeShell color="blue" icon="💬" selected={data.selected}>
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <p className="text-[11px] font-semibold text-blue-700">1ª mensagem</p>
    <p className="mt-1 text-[10px] text-neutral-700 line-clamp-3 whitespace-pre-wrap">
      {data.text || (
        <span className="italic text-neutral-400">vazia · usa template da campanha</span>
      )}
    </p>
    <p className="text-[9px] italic text-neutral-400 mt-0.5">clique para editar</p>
  </NodeShell>
);

const AttachmentsNode = ({ data }: NodeProps<Node<AttachmentsNodeData>>) => (
  <NodeShell color="amber" icon="📎" selected={data.selected}>
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <p className="text-[11px] font-semibold text-amber-700">Anexos</p>
    <p className="text-[10px] text-neutral-600">
      {data.count > 0 ? `${data.count} arquivo(s)` : "nenhum"}
    </p>
    <p className="text-[9px] italic text-neutral-400 mt-0.5">clique para gerenciar</p>
  </NodeShell>
);

const WhatsAppsNode = ({ data }: NodeProps<Node<WhatsAppsNodeData>>) => {
  const totalInstances = data.campaigns.reduce(
    (acc, c) => acc + (c.instanceCount ?? 0),
    0
  );
  const color = totalInstances >= 2 ? "teal" : totalInstances === 1 ? "amber" : "red";
  return (
    <NodeShell color={color} icon="📱" selected={data.selected}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <p
        className={`text-[11px] font-semibold ${
          color === "teal"
            ? "text-teal-700"
            : color === "amber"
              ? "text-amber-700"
              : "text-red-700"
        }`}
      >
        WhatsApps
      </p>
      <p className="text-[10px] text-neutral-600">
        {totalInstances === 0
          ? "Nenhum número conectado"
          : `${totalInstances} número(s) — rotação anti-ban`}
      </p>
      <p className="text-[9px] italic text-neutral-400 mt-0.5">clique para configurar</p>
    </NodeShell>
  );
};

const WaitNode = ({ data }: NodeProps<Node<WaitNodeData>>) => (
  <NodeShell color="neutral" icon="⏳" selected={data.selected}>
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <p className="text-[11px] font-semibold text-neutral-700">Aguarda lead responder</p>
    <p className="text-[10px] text-neutral-500">
      delay {data.min}s–{data.max}s
    </p>
    <p className="text-[9px] italic text-neutral-400 mt-0.5">clique para ajustar</p>
  </NodeShell>
);

const HandoffNode = ({ data }: NodeProps<Node<HandoffNodeData>>) => (
  <NodeShell
    color={data.agent ? "purple" : "red"}
    icon={data.agent ? "🤖" : "⚠️"}
    selected={data.selected}
  >
    <Handle type="target" position={Position.Top} />
    {data.agent ? (
      <>
        <p className="text-[11px] font-semibold text-purple-700">
          Handoff → {data.agent.name}
        </p>
        <p className="text-[10px] text-neutral-500 mb-1">qualifica + executa tools</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {data.tools.length === 0 ? (
            <span className="text-[10px] italic text-neutral-400">
              sem tools selecionadas
            </span>
          ) : (
            data.tools.map((t) => (
              <span
                key={t}
                className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-700"
              >
                {t}
              </span>
            ))
          )}
        </div>
      </>
    ) : (
      <>
        <p className="text-[11px] font-semibold text-red-700">Handoff não configurado</p>
        <p className="text-[10px] text-neutral-500">clique para selecionar</p>
      </>
    )}
  </NodeShell>
);

const nodeTypes = {
  start: StartNode,
  firstMessage: FirstMessageNode,
  attachments: AttachmentsNode,
  whatsapps: WhatsAppsNode,
  wait: WaitNode,
  handoff: HandoffNode
};

const COLOR_MAP: Record<string, { bg: string; border: string; selected: string }> = {
  green: { bg: "#f0fdf4", border: "#86efac", selected: "#22c55e" },
  blue: { bg: "#eff6ff", border: "#93c5fd", selected: "#3b82f6" },
  amber: { bg: "#fffbeb", border: "#fcd34d", selected: "#f59e0b" },
  neutral: { bg: "#fafafa", border: "#d4d4d8", selected: "#71717a" },
  purple: { bg: "#faf5ff", border: "#d8b4fe", selected: "#a855f7" },
  red: { bg: "#fef2f2", border: "#fca5a5", selected: "#ef4444" },
  teal: { bg: "#f0fdfa", border: "#5eead4", selected: "#14b8a6" }
};

function NodeShell({
  color,
  icon,
  selected,
  children
}: {
  color: keyof typeof COLOR_MAP;
  icon: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  const c = COLOR_MAP[color];
  return (
    <div
      className="rounded-xl border-2 px-3 py-2 shadow-sm transition-all"
      style={{
        backgroundColor: c.bg,
        borderColor: selected ? c.selected : c.border,
        borderWidth: selected ? 3 : 2,
        boxShadow: selected ? `0 0 0 4px ${c.bg}, 0 0 0 5px ${c.selected}` : undefined,
        minWidth: 220,
        maxWidth: 260,
        cursor: "pointer"
      }}
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{icon}</span>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function OutboundFlow(props: Props) {
  const {
    firstMessage,
    attachments,
    handoffAgent,
    handoffTools,
    inboundAgents,
    campaigns,
    whatsappInstances,
    delayMin,
    delayMax,
    setFirstMessage,
    setHandoffAgentId,
    setDelayMin,
    setDelayMax,
    onUploadClick,
    onDeleteAttachment,
    onLinkCampaign,
    onUnlinkCampaign,
    onAttachInstance,
    onDetachInstance
  } = props;
  const [selectedId, setSelectedId] = useState<NodeId | null>(null);

  const linkedCampaigns = campaigns.filter((c) => c.isOutbound || c.isInbound);

  const nodes = useMemo<Node[]>(
    () => [
      {
        id: "start",
        type: "start",
        position: { x: 50, y: 0 },
        data: { campaigns: linkedCampaigns, selected: selectedId === "start" }
      },
      {
        id: "first-msg",
        type: "firstMessage",
        position: { x: 50, y: 120 },
        data: { text: firstMessage, selected: selectedId === "first-msg" }
      },
      {
        id: "attachments",
        type: "attachments",
        position: { x: 50, y: 280 },
        data: { count: attachments.length, selected: selectedId === "attachments" }
      },
      {
        id: "whatsapps",
        type: "whatsapps",
        position: { x: 50, y: 400 },
        data: { campaigns: linkedCampaigns, selected: selectedId === "whatsapps" }
      },
      {
        id: "wait",
        type: "wait",
        position: { x: 50, y: 520 },
        data: { min: delayMin, max: delayMax, selected: selectedId === "wait" }
      },
      {
        id: "handoff",
        type: "handoff",
        position: { x: 50, y: 640 },
        data: {
          agent: handoffAgent,
          tools: handoffTools,
          selected: selectedId === "handoff"
        }
      }
    ],
    [
      firstMessage,
      attachments.length,
      handoffAgent,
      handoffTools,
      linkedCampaigns,
      delayMin,
      delayMax,
      selectedId
    ]
  );

  const edges = useMemo<Edge[]>(
    () => [
      { id: "e1", source: "start", target: "first-msg", animated: true },
      { id: "e2", source: "first-msg", target: "attachments" },
      { id: "e3", source: "attachments", target: "whatsapps" },
      { id: "e4", source: "whatsapps", target: "wait" },
      { id: "e5", source: "wait", target: "handoff", animated: true }
    ],
    []
  );

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 min-w-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={(_e, node) => setSelectedId(node.id as NodeId)}
          onPaneClick={() => setSelectedId(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d4d4d8" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {selectedId && (
        <div
          className="w-[320px] flex-shrink-0 bg-white border-l border-neutral-200 shadow-xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 flex-shrink-0">
            <h4 className="text-sm font-semibold text-neutral-800">
              {nodeTitle(selectedId)}
            </h4>
            <button
              onClick={() => setSelectedId(null)}
              className="text-neutral-400 hover:text-neutral-700 text-lg leading-none"
              aria-label="Fechar"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedId === "start" && (
              <StartEditor
                campaigns={campaigns}
                onLink={onLinkCampaign}
                onUnlink={onUnlinkCampaign}
              />
            )}
            {selectedId === "first-msg" && (
              <FirstMessageEditor value={firstMessage} onChange={setFirstMessage} />
            )}
            {selectedId === "attachments" && (
              <AttachmentsEditor
                attachments={attachments}
                onUploadClick={onUploadClick}
                onDelete={onDeleteAttachment}
              />
            )}
            {selectedId === "whatsapps" && (
              <WhatsAppsEditor
                linkedCampaigns={linkedCampaigns}
                instances={whatsappInstances}
                onAttach={onAttachInstance}
                onDetach={onDetachInstance}
              />
            )}
            {selectedId === "wait" && (
              <WaitEditor
                min={delayMin}
                max={delayMax}
                setMin={setDelayMin}
                setMax={setDelayMax}
              />
            )}
            {selectedId === "handoff" && (
              <HandoffEditor
                inbounds={inboundAgents}
                selectedId={handoffAgent?.id ?? ""}
                onChange={setHandoffAgentId}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function nodeTitle(id: NodeId): string {
  switch (id) {
    case "start":
      return "Lead source";
    case "first-msg":
      return "Primeira mensagem";
    case "attachments":
      return "Anexos do agente";
    case "whatsapps":
      return "WhatsApps (rotação anti-ban)";
    case "wait":
      return "Aguarda lead responder";
    case "handoff":
      return "Handoff → Inbound";
  }
}

function StartEditor({
  campaigns,
  onLink,
  onUnlink
}: {
  campaigns: CampaignSummary[];
  onLink: (campaignId: string, role: "outbound" | "inbound") => void;
  onUnlink: (campaignId: string, role: "outbound" | "inbound") => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-600">
        Vincule este agente como <strong>outbound</strong> em uma ou mais campanhas. Os leads
        virão das planilhas (CSV) que você importar em cada campanha.
      </p>
      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-center">
          <p className="text-xs text-neutral-500 mb-2">Nenhuma campanha criada ainda.</p>
          <a
            href="/app/campaigns"
            className="inline-block rounded-lg bg-pi-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Criar campanha →
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => {
            const linked = c.isOutbound || c.isInbound;
            return (
              <div
                key={c.id}
                className={`rounded-lg border px-3 py-2 ${
                  linked
                    ? "border-pi-primary bg-pi-primary/5"
                    : "border-neutral-200"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <a
                    href={`/app/campaigns/${c.id}`}
                    className="text-sm font-medium text-neutral-800 hover:text-pi-primary truncate"
                  >
                    {c.name}
                  </a>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      c.status === "active"
                        ? "bg-green-100 text-green-700"
                        : c.status === "draft"
                          ? "bg-neutral-100 text-neutral-500"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {c.isOutbound && (
                    <button
                      onClick={() => onUnlink(c.id, "outbound")}
                      className="rounded-full bg-pi-primary text-white px-2 py-0.5 text-[10px] font-medium hover:opacity-90"
                      title="Clique para desvincular"
                    >
                      ✓ outbound
                    </button>
                  )}
                  {c.isInbound && (
                    <button
                      onClick={() => onUnlink(c.id, "inbound")}
                      className="rounded-full bg-purple-500 text-white px-2 py-0.5 text-[10px] font-medium hover:opacity-90"
                      title="Clique para desvincular"
                    >
                      ✓ inbound
                    </button>
                  )}
                  {!c.isOutbound && (
                    <button
                      onClick={() => onLink(c.id, "outbound")}
                      className="rounded-full border border-neutral-300 text-neutral-600 px-2 py-0.5 text-[10px] font-medium hover:border-pi-primary hover:text-pi-primary"
                    >
                      + outbound
                    </button>
                  )}
                  {!c.isInbound && (
                    <button
                      onClick={() => onLink(c.id, "inbound")}
                      className="rounded-full border border-neutral-300 text-neutral-600 px-2 py-0.5 text-[10px] font-medium hover:border-purple-500 hover:text-purple-700"
                    >
                      + inbound
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <a
            href="/app/campaigns"
            className="block rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-center text-xs text-neutral-500 hover:border-pi-primary hover:text-pi-primary"
          >
            + Nova campanha
          </a>
        </div>
      )}
    </div>
  );
}

function FirstMessageEditor({
  value,
  onChange
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-600">
        Mensagem enviada ao lead no primeiro toque. Skipa LLM, é rápido e barato.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder="Oi {{name}}! Vi que você se interessou pelo {{property_ref}}. Posso te enviar mais detalhes?"
        className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-pi-primary"
      />
      <div className="rounded-lg bg-neutral-50 p-3">
        <p className="text-[11px] font-semibold text-neutral-700 mb-1">Variáveis</p>
        <div className="flex flex-wrap gap-1">
          {["name", "phone", "property_ref", "origin", "campaign"].map((v) => (
            <button
              key={v}
              onClick={() => onChange(value + `{{${v}}}`)}
              className="rounded bg-white border border-neutral-200 px-1.5 py-0.5 text-[10px] font-mono text-neutral-700 hover:border-pi-primary hover:text-pi-primary"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </div>
      {!value.trim() && (
        <p className="text-[11px] text-neutral-400">
          Vazio = usa o template definido na campanha.
        </p>
      )}
    </div>
  );
}

function AttachmentsEditor({
  attachments,
  onUploadClick,
  onDelete
}: {
  attachments: Attachment[];
  onUploadClick: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-600">
        PDFs, vídeos, imagens. Disponibilizados ao agente como contexto + opcionais
        ao enviar via tools.
      </p>
      <button
        onClick={onUploadClick}
        className="w-full rounded-lg border-2 border-dashed border-neutral-300 px-4 py-3 text-sm font-medium text-pi-primary hover:border-pi-primary hover:bg-pi-primary/5"
      >
        + Adicionar arquivo
      </button>
      <div className="space-y-2">
        {attachments.length === 0 ? (
          <p className="text-[11px] text-neutral-400 text-center py-2">
            Nenhum anexo ainda.
          </p>
        ) : (
          attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2 py-1.5"
            >
              <span>{a.kind === "image" ? "🖼️" : a.kind === "video" ? "🎬" : "📄"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-neutral-700 truncate">{a.filename}</p>
                <p className="text-[10px] text-neutral-400">
                  {(a.sizeBytes / 1024).toFixed(0)} KB
                </p>
              </div>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-pi-primary hover:underline"
              >
                Abrir
              </a>
              <button
                onClick={() => {
                  if (confirm("Remover anexo?")) onDelete(a.id);
                }}
                className="text-[10px] text-red-500 hover:underline"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WhatsAppsEditor({
  linkedCampaigns,
  instances,
  onAttach,
  onDetach
}: {
  linkedCampaigns: CampaignSummary[];
  instances: WhatsAppInstance[];
  onAttach: (campaignId: string, instanceId: string) => void;
  onDetach: (campaignId: string, instanceId: string) => void;
}) {
  const activeInstances = instances.filter((i) => i.active);

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
        <p className="text-[11px] text-blue-800 leading-relaxed">
          Para evitar ban, marque 2+ números em cada campanha. O sistema alterna
          automaticamente (sticky por conversa, LRU entre conversas novas).
        </p>
      </div>

      {linkedCampaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800 font-medium mb-1">
            ⚠️ Vincule este agente a uma campanha primeiro
          </p>
          <p className="text-[11px] text-amber-700">
            WhatsApps são marcados por campanha. Vá ao nó <strong>Lead source</strong> e
            vincule este agente.
          </p>
        </div>
      ) : activeInstances.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-3 text-center">
          <p className="text-xs text-neutral-500 mb-2">
            Nenhuma instância de WhatsApp ativa no sistema.
          </p>
          <a
            href="/app/instances"
            className="inline-block rounded-lg bg-pi-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Conectar WhatsApp →
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {linkedCampaigns.map((c) => {
            const attachedSet = new Set(c.instanceIds);
            const checkedCount = attachedSet.size;
            return (
              <div key={c.id} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-neutral-800 truncate">
                    {c.name}
                  </span>
                  <span
                    className={`text-[10px] font-medium ${
                      checkedCount >= 2
                        ? "text-green-600"
                        : checkedCount === 1
                          ? "text-amber-600"
                          : "text-red-600"
                    }`}
                  >
                    {checkedCount}/{activeInstances.length} marcados
                  </span>
                </div>
                <div className="space-y-1.5">
                  {activeInstances.map((i) => {
                    const isAttached = attachedSet.has(i.id);
                    return (
                      <label
                        key={i.id}
                        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer transition-colors ${
                          isAttached
                            ? "border-pi-primary bg-pi-primary/5"
                            : "border-neutral-200 hover:bg-neutral-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isAttached}
                          onChange={(e) => {
                            if (e.target.checked) onAttach(c.id, i.id);
                            else onDetach(c.id, i.id);
                          }}
                          className="accent-pi-primary"
                        />
                        <StatusDot status={i.status} />
                        <span className="flex-1 text-xs text-neutral-700 truncate">
                          {i.number}
                        </span>
                        <span className="text-[10px] text-neutral-400">{i.provider}</span>
                      </label>
                    );
                  })}
                </div>
                {checkedCount < 2 && (
                  <p className="mt-2 text-[10px] text-amber-600">
                    ⚠️ Recomendado: 2+ números marcados pra rotação efetiva
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "pending" || status === "qr_required"
        ? "bg-amber-500"
        : "bg-red-500";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

function WaitEditor({
  min,
  max,
  setMin,
  setMax
}: {
  min: number;
  max: number;
  setMin: (v: number) => void;
  setMax: (v: number) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-600">
        Tempo de "digitação" simulado antes de enviar. Aleatório no intervalo
        configurado — humaniza o agente e reduz risco de ban.
      </p>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Mínimo: {min}s
        </label>
        <input
          type="range"
          min="0"
          max="60"
          step="1"
          value={min}
          onChange={(e) => setMin(Math.min(Number(e.target.value), max))}
          className="w-full"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Máximo: {max}s
        </label>
        <input
          type="range"
          min="0"
          max="60"
          step="1"
          value={max}
          onChange={(e) => setMax(Math.max(Number(e.target.value), min))}
          className="w-full"
        />
      </div>
      <p className="text-[11px] text-neutral-400">
        Quando agente está numa campanha, o delay da campanha sobrescreve este.
      </p>
    </div>
  );
}

function HandoffEditor({
  inbounds,
  selectedId,
  onChange
}: {
  inbounds: AgentRow[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-600">
        Quando o lead responder à primeira mensagem, a conversa transfere
        automaticamente para este agente inbound (que tem todas as tools de
        qualificação, handoff, etc.).
      </p>
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
      >
        <option value="">— selecione um agente inbound —</option>
        {inbounds.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {inbounds.length === 0 && (
        <p className="text-[11px] text-red-500">
          Nenhum agente inbound ativo encontrado.{" "}
          <a href="/app/agents" className="underline">
            Criar
          </a>
          .
        </p>
      )}
      {!selectedId && (
        <p className="text-[11px] text-amber-600">
          ⚠️ Sem inbound, o outbound continuará atendendo (com prompt/tools limitados).
        </p>
      )}
    </div>
  );
}
