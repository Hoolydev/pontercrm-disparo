"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";

type Instance = {
  id: string;
  provider: "uazapi" | "meta" | "evolution";
  number: string;
  status: "connected" | "disconnected" | "pending" | "banned";
  active: boolean;
  messagesSentLastMinute: number;
  rateLimitPerMinute: number;
  configJson: Record<string, unknown>;
};

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-green-100 text-green-700",
  disconnected: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  banned: "bg-red-200 text-red-800"
};

type Provider = "uazapi" | "meta" | "evolution";

type ProviderFields = Record<string, string>;

const PROVIDER_LABELS: Record<Provider, string> = {
  uazapi: "Uazapi",
  meta: "Meta Cloud API",
  evolution: "Evolution / Z-API"
};

const PROVIDER_DEFAULTS: Record<Provider, ProviderFields> = {
  uazapi: { baseUrl: "https://", token: "" },
  meta: {
    phoneNumberId: "",
    accessToken: "",
    businessAccountId: "",
    verifyToken: "",
    appSecret: ""
  },
  evolution: { baseUrl: "https://", token: "", instanceName: "" }
};

const PROVIDER_FIELD_SPECS: Record<
  Provider,
  Array<{ key: string; label: string; placeholder?: string; hint?: string; secret?: boolean }>
> = {
  uazapi: [
    { key: "baseUrl", label: "Base URL", placeholder: "https://pointerimoveis.uazapi.com" },
    {
      key: "token",
      label: "Token",
      placeholder: "1aa7d90b-013c-4b5e-…",
      secret: true,
      hint: "Token gerado no painel uazapi"
    }
  ],
  meta: [
    {
      key: "phoneNumberId",
      label: "Phone Number ID",
      placeholder: "108524…",
      hint: "ID do número no Meta Business Manager"
    },
    {
      key: "accessToken",
      label: "Access Token",
      placeholder: "EAAxxxx…",
      secret: true,
      hint: "System User token (long-lived)"
    },
    { key: "businessAccountId", label: "WhatsApp Business Account ID", placeholder: "1234567890" },
    {
      key: "verifyToken",
      label: "Verify Token (webhook)",
      placeholder: "string segredo",
      secret: true,
      hint: "Configure este valor no webhook do Meta"
    },
    {
      key: "appSecret",
      label: "App Secret",
      placeholder: "32-char hex",
      secret: true,
      hint: "Valida X-Hub-Signature do Meta"
    }
  ],
  evolution: [
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.z-api.io" },
    {
      key: "instanceName",
      label: "Instance ID / Name",
      placeholder: "3D8A7C…",
      hint: "ID da instância no provedor"
    },
    { key: "token", label: "Token", placeholder: "5xxxxx…", secret: true }
  ]
};

export default function InstancesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["instances"],
    queryFn: () => api.get<{ instances: Instance[] }>("/whatsapp-instances")
  });

  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<Provider>("uazapi");
  const [number, setNumber] = useState("");
  const [rate, setRate] = useState(20);
  const [fields, setFields] = useState<ProviderFields>({ ...PROVIDER_DEFAULTS.uazapi });
  const [qrData, setQrData] = useState<{ id: string; qr: string | null } | null>(null);

  function changeProvider(p: Provider) {
    setProvider(p);
    setFields({ ...PROVIDER_DEFAULTS[p] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/whatsapp-instances", {
        provider,
        number,
        rateLimitPerMinute: rate,
        configJson: { ...fields }
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      setShowForm(false);
      setNumber("");
      setFields({ ...PROVIDER_DEFAULTS[provider] });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/whatsapp-instances/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/whatsapp-instances/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] })
  });

  const connectMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ qr: string | null }>(`/whatsapp-instances/${id}/connect`),
    onSuccess: (res, id) => setQrData({ id, qr: res.qr })
  });

  const pollQrMutation = useMutation({
    mutationFn: (id: string) =>
      api.get<{ qr: string | null; status: string }>(`/whatsapp-instances/${id}/qr`),
    onSuccess: (res, id) => {
      if (res.status === "connected") {
        setQrData(null);
        qc.invalidateQueries({ queryKey: ["instances"] });
      } else {
        setQrData({ id, qr: res.qr });
      }
    }
  });

  const refreshStatusMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ status: string }>(`/whatsapp-instances/${id}/refresh-status`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] })
  });

  const fieldsValid = PROVIDER_FIELD_SPECS[provider].every(
    (f) => fields[f.key]?.trim().length
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-neutral-900">Instâncias WhatsApp</h1>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Nova instância
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700">Nova instância</h2>

          {/* Provider selector tabs */}
          <div className="mb-5 flex gap-2 flex-wrap">
            {(["uazapi", "meta", "evolution"] as const).map((p) => (
              <button
                key={p}
                onClick={() => changeProvider(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  provider === p
                    ? "bg-pi-primary text-white"
                    : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Número (E.164)">
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="input"
                placeholder="+5511999999999"
              />
            </Field>
            <Field label="Limite msgs/min">
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="input"
                min={1}
                max={200}
              />
            </Field>

            {PROVIDER_FIELD_SPECS[provider].map((spec) => (
              <Field
                key={spec.key}
                label={spec.label}
                hint={spec.hint}
                className="sm:col-span-2"
              >
                <input
                  value={fields[spec.key] ?? ""}
                  onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })}
                  type={spec.secret ? "password" : "text"}
                  placeholder={spec.placeholder}
                  className="input font-mono"
                />
              </Field>
            ))}
          </div>

          {provider === "meta" && (
            <p className="mt-3 text-[11px] text-neutral-500">
              Webhook URL do Meta:{" "}
              <code className="bg-neutral-100 px-1 rounded">
                /webhooks/whatsapp/meta/&lt;instance-id&gt;
              </code>{" "}
              · Configure após criar a instância.
            </p>
          )}
          {provider === "evolution" && (
            <p className="mt-3 text-[11px] text-neutral-500">
              Configure o webhook do Z-API/Evolution apontando para:{" "}
              <code className="bg-neutral-100 px-1 rounded">
                /webhooks/whatsapp/evolution/&lt;instance-id&gt;
              </code>
            </p>
          )}

          <div className="flex gap-2 mt-5">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!number || !fieldsValid || createMutation.isPending}
              className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {createMutation.isPending ? "Criando…" : "Criar instância"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
          {createMutation.isError && (
            <p className="mt-2 text-xs text-red-500">{createMutation.error?.message}</p>
          )}

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
      )}

      {/* QR Modal (uazapi only) */}
      {qrData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-base font-semibold text-neutral-900 mb-4">
              Conectar via QR Code
            </h2>
            {qrData.qr ? (
              <div className="flex flex-col items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrData.qr} alt="QR Code" className="w-48 h-48 border rounded-lg" />
                <p className="text-xs text-neutral-500 text-center">
                  Escaneie com o WhatsApp. Clique em &quot;Atualizar&quot; após escanear.
                </p>
              </div>
            ) : (
              <p className="text-sm text-neutral-500 text-center py-4">Gerando QR code…</p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => pollQrMutation.mutate(qrData.id)}
                disabled={pollQrMutation.isPending}
                className="flex-1 rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Atualizar
              </button>
              <button
                onClick={() => setQrData(null)}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-neutral-400">Carregando…</p>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">
            Falha ao carregar instâncias
          </p>
          <p className="mt-1 text-xs text-red-600">
            {error instanceof Error ? error.message : "erro desconhecido"}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data?.instances.map((inst) => (
            <div
              key={inst.id}
              className={`rounded-xl border bg-white p-4 shadow-sm ${
                inst.active ? "border-neutral-200" : "border-neutral-100 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{inst.number}</p>
                  <p className="text-xs text-neutral-400 capitalize">{inst.provider}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_COLORS[inst.status] ?? "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {inst.status}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
                <div className="flex-1 bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-pi-primary h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (inst.messagesSentLastMinute / inst.rateLimitPerMinute) * 100)}%`
                    }}
                  />
                </div>
                <span>
                  {inst.messagesSentLastMinute}/{inst.rateLimitPerMinute} msgs/min
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {inst.provider === "uazapi" && (
                  <>
                    <button
                      onClick={() => connectMutation.mutate(inst.id)}
                      disabled={connectMutation.isPending}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Conectar QR
                    </button>
                    <button
                      onClick={() => refreshStatusMutation.mutate(inst.id)}
                      disabled={refreshStatusMutation.isPending}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      title="Consulta a Uazapi e atualiza o status real (use se já conectou direto na Uazapi)"
                    >
                      {refreshStatusMutation.isPending &&
                      refreshStatusMutation.variables === inst.id
                        ? "Verificando…"
                        : "↻ Verificar conexão"}
                    </button>
                  </>
                )}
                <button
                  onClick={() => toggleMutation.mutate(inst.id)}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  {inst.active ? "Desativar" : "Ativar"}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir instância ${inst.number}?`))
                      deleteMutation.mutate(inst.id);
                  }}
                  className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Excluir
                </button>
              </div>
              {refreshStatusMutation.isError &&
                refreshStatusMutation.variables === inst.id && (
                  <p className="mt-2 text-[11px] text-red-600">
                    {refreshStatusMutation.error instanceof Error
                      ? refreshStatusMutation.error.message
                      : "erro ao consultar Uazapi"}
                  </p>
                )}
            </div>
          ))}
          {data?.instances.length === 0 && (
            <p className="col-span-2 text-center text-sm text-neutral-400 py-10">
              Nenhuma instância configurada.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  className
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-neutral-600 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}
