"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";

type Source = {
  id: string;
  type: string;
  name: string;
  active: boolean;
  webhookUrl: string;
  webhookSecret: string;
  createdAt: string;
};

export default function SourcesPage() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("zap");
  const [revealId, setRevealId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["lead-sources"],
    queryFn: () => api.get<{ sources: Source[] }>("/lead-sources").then((r) => r.sources)
  });

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; webhookUrl: string; webhookSecret: string }>(
      "/lead-sources",
      { type: newType, name: newName }
    ),
    onSuccess: (res) => {
      setRevealedSecret((prev) => ({ ...prev, [res.id]: res.webhookSecret }));
      setNewName("");
      qc.invalidateQueries({ queryKey: ["lead-sources"] });
    }
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.patch(`/lead-sources/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-sources"] })
  });

  const regen = useMutation({
    mutationFn: (id: string) =>
      api.post<{ webhookSecret: string }>(`/lead-sources/${id}/regen-secret`),
    onSuccess: (res, id) => {
      setRevealedSecret((prev) => ({ ...prev, [id]: res.webhookSecret }));
      qc.invalidateQueries({ queryKey: ["lead-sources"] });
    }
  });

  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="mb-5 text-xl font-semibold text-neutral-800">Fontes de Lead</h1>

      {/* Create form */}
      <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Nova fonte</h2>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Tipo</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              <option value="zap">ZAP Imóveis</option>
              <option value="vivareal">VivaReal</option>
              <option value="website">Site próprio</option>
              <option value="manual">Manual</option>
              <option value="other">Outro</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-neutral-500 mb-1">Nome</label>
            <input
              type="text"
              placeholder="ex: ZAP Residencial SP"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={!newName.trim() || create.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {create.isPending ? "Criando…" : "Criar"}
          </button>
        </div>
      </div>

      {/* Sources list */}
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-neutral-400">Carregando…</p>
        )}
        {data?.map((src) => (
          <SourceCard
            key={src.id}
            source={src}
            revealedSecret={revealedSecret[src.id]}
            onToggle={() => toggle.mutate(src.id)}
            onRegen={() => regen.mutate(src.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  revealedSecret,
  onToggle,
  onRegen
}: {
  source: Source;
  revealedSecret?: string;
  onToggle: () => void;
  onRegen: () => void;
}) {
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);

  function copy(text: string, kind: "url" | "secret") {
    navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  const secret = revealedSecret ?? source.webhookSecret;

  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm ${
        source.active ? "border-neutral-200" : "border-neutral-100 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-neutral-800">{source.name}</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            Tipo: <span className="font-mono">{source.type}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              source.active
                ? "bg-green-100 text-green-700"
                : "bg-neutral-100 text-neutral-500"
            }`}
          >
            {source.active ? "Ativo" : "Inativo"}
          </span>
          <button
            onClick={onToggle}
            className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs hover:bg-neutral-50"
          >
            {source.active ? "Desativar" : "Ativar"}
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <FieldRow
          label="Webhook URL"
          value={source.webhookUrl}
          copied={copied === "url"}
          onCopy={() => copy(source.webhookUrl, "url")}
        />
        <FieldRow
          label="Secret"
          value={secret}
          masked={!revealedSecret}
          copied={copied === "secret"}
          onCopy={() => copy(secret, "secret")}
          extra={
            <button
              onClick={onRegen}
              className="ml-2 text-xs text-orange-600 hover:underline"
            >
              Regenerar
            </button>
          }
        />
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  masked = false,
  copied,
  onCopy,
  extra
}: {
  label: string;
  value: string;
  masked?: boolean;
  copied: boolean;
  onCopy: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 flex-shrink-0 text-xs text-neutral-400">{label}</span>
      <code className="flex-1 truncate rounded bg-neutral-50 px-2 py-1 text-xs font-mono text-neutral-600">
        {masked ? "••••••••••••••••••••••••••••••••" : value}
      </code>
      <button
        onClick={onCopy}
        className="flex-shrink-0 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
      >
        {copied ? "Copiado!" : "Copiar"}
      </button>
      {extra}
    </div>
  );
}
