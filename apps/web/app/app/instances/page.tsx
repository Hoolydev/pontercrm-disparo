"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, API_BASE_URL } from "../../../lib/api";

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
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // After creating a Meta instance, surface the exact webhook URL + verify
  // token the user must paste into Meta Developer Console. The verify token
  // is only visible at this moment — once the instance is listed, the
  // backend masks it.
  const [metaSetup, setMetaSetup] = useState<
    | { id: string; verifyToken: string | null; number: string }
    | null
  >(null);
  const [testSendInst, setTestSendInst] = useState<
    | { id: string; number: string }
    | null
  >(null);

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
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      const createdNumber = number;
      const verifyToken = fields.verifyToken ?? null;
      const createdProvider = provider;
      setShowForm(false);
      setNumber("");
      setFields({ ...PROVIDER_DEFAULTS[provider] });
      setSuccessMsg(`Instância ${createdNumber} criada com sucesso!`);
      setTimeout(() => setSuccessMsg(null), 4000);
      if (createdProvider === "meta") {
        setMetaSetup({ id: res.id, verifyToken, number: createdNumber });
      }
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

  const [probeErrors, setProbeErrors] = useState<Record<string, string | null>>({});
  const refreshStatusMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ status: string; probeError?: string | null; raw?: { httpStatus?: number } }>(
        `/whatsapp-instances/${id}/refresh-status`
      ),
    onSuccess: (res, id) => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      setProbeErrors((prev) => ({ ...prev, [id]: res.probeError ?? null }));
    }
  });

  const fieldsValid = PROVIDER_FIELD_SPECS[provider].every(
    (f) => fields[f.key]?.trim().length
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-neutral-900">Instâncias WhatsApp</h1>
        <button
          onClick={() => { setShowForm(true); setSuccessMsg(null); }}
          className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Nova instância
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
          <span>✓</span> {successMsg}
        </div>
      )}

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
              Após criar a instância, exibimos a URL completa do webhook
              pronta para colar no Meta Developer Console.
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
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {createMutation.error?.message?.includes("403") || createMutation.error?.message?.includes("Forbidden")
                ? "Permissão negada: apenas administradores podem criar instâncias."
                : createMutation.error?.message ?? "Erro ao criar instância."}
            </div>
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

      {/* Meta webhook setup modal — shown right after creating a Meta instance */}
      {metaSetup && (
        <MetaWebhookModal
          id={metaSetup.id}
          number={metaSetup.number}
          verifyToken={metaSetup.verifyToken}
          onClose={() => setMetaSetup(null)}
        />
      )}

      {/* Meta test-send modal — pick template, fill params, fire one message */}
      {testSendInst && (
        <MetaTestSendModal
          id={testSendInst.id}
          number={testSendInst.number}
          onClose={() => setTestSendInst(null)}
        />
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
                {inst.provider === "meta" && (
                  <>
                    <button
                      onClick={() =>
                        setMetaSetup({
                          id: inst.id,
                          verifyToken: null,
                          number: inst.number
                        })
                      }
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      title="Mostrar URL de webhook para configurar no Meta"
                    >
                      Webhook Meta
                    </button>
                    <button
                      onClick={() => refreshStatusMutation.mutate(inst.id)}
                      disabled={refreshStatusMutation.isPending}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      title="Valida o token na Graph API e atualiza o status"
                    >
                      {refreshStatusMutation.isPending &&
                      refreshStatusMutation.variables === inst.id
                        ? "Verificando…"
                        : "↻ Verificar conexão"}
                    </button>
                    <button
                      onClick={() =>
                        setTestSendInst({ id: inst.id, number: inst.number })
                      }
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      title="Disparar um template aprovado para um número de teste"
                    >
                      Enviar teste
                    </button>
                  </>
                )}
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
                      : "erro ao consultar provedor"}
                  </p>
                )}
              {probeErrors[inst.id] && inst.status === "disconnected" && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 break-words">
                  <p className="font-medium mb-0.5">Motivo retornado pela Graph API:</p>
                  <code className="font-mono whitespace-pre-wrap break-all">
                    {probeErrors[inst.id]}
                  </code>
                  <ul className="mt-1.5 list-disc pl-4 space-y-0.5 text-red-600">
                    <li>
                      <code>190 / OAuthException</code> → access token expirado ou inválido
                    </li>
                    <li>
                      <code>200 / 10</code> → token sem permissão{" "}
                      <code>whatsapp_business_messaging</code>/
                      <code>whatsapp_business_management</code>, ou System User
                      não foi atribuído ao número/WABA
                    </li>
                    <li>
                      <code>100 / Unsupported get</code> → phoneNumberId inválido
                      (verifique se não colou o WABA ID ou o número de telefone
                      em vez do <em>Phone Number ID</em>)
                    </li>
                  </ul>
                </div>
              )}
            </div>
          ))}
          {data?.instances.filter(i => !(i.configJson as any).__error).length === 0 && (
            <p className="col-span-2 text-center text-sm text-neutral-400 py-10">
              Nenhuma instância configurada.
            </p>
          )}
          {data?.instances.some(i => (i.configJson as any).__error) && (
            <div className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              ⚠️ {data.instances.filter(i => (i.configJson as any).__error).length} instância(s) com erro de descriptografia — foram criadas com uma chave de criptografia diferente e precisam ser recriadas.
            </div>
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

function MetaWebhookModal({
  id,
  number,
  verifyToken,
  onClose
}: {
  id: string;
  number: string;
  verifyToken: string | null;
  onClose: () => void;
}) {
  const webhookUrl = `${API_BASE_URL}/webhooks/whatsapp/meta/${id}`;
  const [copied, setCopied] = useState<string | null>(null);

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Configurar webhook no Meta
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Instância {number} — cole estes valores em{" "}
              <span className="font-medium">
                Meta Developer Console → WhatsApp → Configuration → Webhooks
              </span>
              .
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 text-lg leading-none"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Callback URL
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={webhookUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-neutral-50"
              />
              <button
                onClick={() => copy(webhookUrl, "url")}
                className="rounded-lg bg-pi-primary px-3 py-2 text-xs font-medium text-white hover:opacity-90 whitespace-nowrap"
              >
                {copied === "url" ? "Copiado ✓" : "Copiar"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Verify Token
            </label>
            {verifyToken ? (
              <div className="flex gap-2">
                <input
                  readOnly
                  value={verifyToken}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-neutral-50"
                />
                <button
                  onClick={() => copy(verifyToken, "token")}
                  className="rounded-lg bg-pi-primary px-3 py-2 text-xs font-medium text-white hover:opacity-90 whitespace-nowrap"
                >
                  {copied === "token" ? "Copiado ✓" : "Copiar"}
                </button>
              </div>
            ) : (
              <p className="text-xs text-neutral-500 italic">
                Use o mesmo Verify Token que você cadastrou ao criar a instância.
                Por segurança ele não é exibido depois — se esqueceu, edite a
                instância e atualize o valor.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs font-medium text-amber-800 mb-1">
              Antes de clicar &quot;Verificar e salvar&quot; no Meta:
            </p>
            <ul className="text-[11px] text-amber-700 list-disc pl-4 space-y-0.5">
              <li>
                Confirme que a API está deployada e acessível no domínio acima.
              </li>
              <li>
                Em &quot;Webhook fields&quot;, assine{" "}
                <code className="bg-amber-100 px-1 rounded">messages</code>.
              </li>
              <li>
                Se a verificação falhar, teste a URL no terminal — veja o
                rodapé deste modal.
              </li>
            </ul>
          </div>

          <details className="text-[11px] text-neutral-600">
            <summary className="cursor-pointer hover:text-neutral-900">
              Testar manualmente com curl
            </summary>
            <pre className="mt-2 bg-neutral-900 text-neutral-100 rounded-lg p-3 text-[10px] overflow-x-auto">
{`curl -i "${webhookUrl}?hub.mode=subscribe&hub.challenge=ping&hub.verify_token=${verifyToken ?? "<seu-token>"}"`}
            </pre>
            <p className="mt-1 text-[10px] text-neutral-500">
              Esperado: <span className="font-mono">200 OK</span> com body{" "}
              <span className="font-mono">ping</span>.
            </p>
          </details>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

type TemplateComponent = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS" | string;
  format?: "TEXT" | "VIDEO" | "IMAGE" | "DOCUMENT";
  text?: string;
  example?: {
    body_text_named_params?: Array<{ param_name: string; example: string }>;
    body_text?: string[][];
    header_handle?: string[];
    header_text?: string[];
  };
  buttons?: Array<{ type: string; text: string }>;
};

type ApprovedTemplate = {
  name: string;
  language: string;
  status: string;
  category: string | null;
  bodyText: string | null;
  bodyParamCount: number;
  // We re-fetch the full template separately to get raw components for the
  // test-send mapping. This list endpoint only returns the lite shape.
};

type FullTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
  components: TemplateComponent[];
};

function MetaTestSendModal({
  id,
  number,
  onClose
}: {
  id: string;
  number: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [selectedName, setSelectedName] = useState<string>("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [bodyParams, setBodyParams] = useState<Record<string, string>>({});
  const [headerTextParams, setHeaderTextParams] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<unknown>(null);

  // Fetch the lite list of approved templates for the dropdown.
  const tplsQuery = useQuery({
    queryKey: ["meta-templates", id],
    queryFn: () =>
      api.get<{ templates: ApprovedTemplate[] }>(
        `/whatsapp-instances/${id}/meta-templates?status=APPROVED`
      )
  });

  // Fetch full component breakdown for the picked template (so we know whether
  // to render header media input, named-param inputs, etc.).
  const fullTplQuery = useQuery({
    enabled: !!selectedName,
    queryKey: ["meta-template-full", id, selectedName],
    queryFn: async () => {
      const list = await api.get<{ templates: ApprovedTemplate[] }>(
        `/whatsapp-instances/${id}/meta-templates`
      );
      return list.templates.find((t) => t.name === selectedName) ?? null;
    }
  });

  // Re-derive body placeholders from the lite shape (matches /meta-templates).
  const liteSelected = tplsQuery.data?.templates.find(
    (t) => t.name === selectedName
  );
  const bodyText = liteSelected?.bodyText ?? "";
  const namedPlaceholders = Array.from(
    bodyText.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)
  ).map((m) => m[1]);
  const positionalCount = namedPlaceholders.length
    ? 0
    : Array.from(bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).length;

  // Header media is needed when the template has a HEADER component with
  // VIDEO/IMAGE/DOCUMENT format. We can't tell from the lite shape, so heuristic:
  // ask the user to fill if the template is the well-known mensagem_nativa,
  // or always show the optional input when picked. The full fetch isn't wired
  // server-side for components (out of scope), so we use a free-text URL input
  // and let the API surface the Meta error if mandatory.
  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!liteSelected) throw new Error("template not selected");
      const components: Array<Record<string, unknown>> = [];
      if (headerMediaUrl.trim()) {
        const url = headerMediaUrl.trim();
        const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
        const mediaType = ["mp4", "mov", "3gp"].includes(ext)
          ? "video"
          : ["jpg", "jpeg", "png", "webp"].includes(ext)
          ? "image"
          : "document";
        components.push({
          type: "header",
          parameters: [{ type: mediaType, [mediaType]: { link: url } }]
        });
      }
      const headerTextKeys = Object.keys(headerTextParams).filter(
        (k) => headerTextParams[k]
      );
      if (headerTextKeys.length) {
        components.push({
          type: "header",
          parameters: headerTextKeys.map((k) => ({
            type: "text",
            text: headerTextParams[k]
          }))
        });
      }
      if (namedPlaceholders.length) {
        components.push({
          type: "body",
          parameters: namedPlaceholders.map((name) => ({
            type: "text",
            parameter_name: name,
            text: bodyParams[name] ?? ""
          }))
        });
      } else if (positionalCount > 0) {
        components.push({
          type: "body",
          parameters: Array.from({ length: positionalCount }, (_, i) => ({
            type: "text",
            text: bodyParams[String(i + 1)] ?? ""
          }))
        });
      }
      const res = await api.post(`/whatsapp-instances/${id}/test-send`, {
        to: to.trim(),
        template: liteSelected.name,
        language: liteSelected.language,
        components
      });
      return res;
    },
    onSuccess: (res) => setResponse(res),
    onError: (err) => setResponse({ error: err instanceof Error ? err.message : String(err) })
  });

  const r = response as
    | {
        ok?: boolean;
        httpStatus?: number;
        response?: { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
        senderHealth?: {
          name_status?: string;
          quality_rating?: string;
          account_mode?: string;
        };
        error?: string;
      }
    | null;

  const senderWarning =
    r?.senderHealth?.name_status &&
    r.senderHealth.name_status !== "APPROVED" &&
    r.senderHealth.name_status !== "AVAILABLE_WITHOUT_REVIEW"
      ? `Display name está ${r.senderHealth.name_status} — Meta vai aceitar (status accepted) mas não entrega até o nome ser aprovado.`
      : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Enviar template de teste
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Instância {number} — dispara uma única mensagem direto na Graph
              API, sem passar pela fila/rate-limit.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 text-lg leading-none"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Destinatário (E.164)
            </label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+5562982540748"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Template aprovado
            </label>
            {tplsQuery.isLoading ? (
              <p className="text-xs text-neutral-400">Carregando…</p>
            ) : tplsQuery.isError ? (
              <p className="text-xs text-red-600">
                Falha ao listar templates: {String(tplsQuery.error)}
              </p>
            ) : (
              <select
                value={selectedName}
                onChange={(e) => {
                  setSelectedName(e.target.value);
                  setBodyParams({});
                  setHeaderTextParams({});
                  setHeaderMediaUrl("");
                  setResponse(null);
                }}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
              >
                <option value="">— escolha —</option>
                {tplsQuery.data?.templates.map((t) => (
                  <option key={`${t.name}:${t.language}`} value={t.name}>
                    {t.name} [{t.language}] — {t.bodyParamCount} param(s)
                  </option>
                ))}
              </select>
            )}
          </div>

          {liteSelected && (
            <>
              {liteSelected.bodyText && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700 whitespace-pre-wrap">
                  <span className="font-medium text-neutral-500">Body:</span>{" "}
                  {liteSelected.bodyText}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  Header media URL (preencha se o template tem HEADER de vídeo/imagem/PDF)
                </label>
                <input
                  value={headerMediaUrl}
                  onChange={(e) => setHeaderMediaUrl(e.target.value)}
                  placeholder="https://exemplo.com/video.mp4"
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-mono"
                />
                <p className="mt-1 text-[10px] text-neutral-400">
                  Detecta tipo pela extensão (mp4/mov→video, jpg/png/webp→image,
                  outros→document). URL precisa ser pública.
                </p>
              </div>

              {namedPlaceholders.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-neutral-600">
                    Body params (named)
                  </label>
                  {namedPlaceholders.map((name) => (
                    <div key={name}>
                      <p className="text-[11px] text-neutral-500 mb-0.5">
                        <code className="font-mono">{`{{${name}}}`}</code>
                      </p>
                      <input
                        value={bodyParams[name] ?? ""}
                        onChange={(e) =>
                          setBodyParams({ ...bodyParams, [name]: e.target.value })
                        }
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                        placeholder={`valor para ${name}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {positionalCount > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-neutral-600">
                    Body params (posicional)
                  </label>
                  {Array.from({ length: positionalCount }, (_, i) => i + 1).map((n) => (
                    <div key={n}>
                      <p className="text-[11px] text-neutral-500 mb-0.5">
                        <code className="font-mono">{`{{${n}}}`}</code>
                      </p>
                      <input
                        value={bodyParams[String(n)] ?? ""}
                        onChange={(e) =>
                          setBodyParams({ ...bodyParams, [String(n)]: e.target.value })
                        }
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => sendMutation.mutate()}
              disabled={
                !to.trim() || !selectedName || sendMutation.isPending
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {sendMutation.isPending ? "Enviando…" : "Enviar"}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Fechar
            </button>
          </div>

          {r && (
            <div
              className={`rounded-lg border px-3 py-2.5 text-xs ${
                r.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              <p className="font-medium mb-1">
                {r.ok
                  ? `Aceito pela Meta (HTTP ${r.httpStatus})`
                  : `Falhou (HTTP ${r.httpStatus ?? "?"})`}
              </p>
              {r.response?.messages?.[0]?.id && (
                <p className="font-mono break-all">
                  wamid: {r.response.messages[0].id}
                </p>
              )}
              {r.response?.error?.message && (
                <p className="font-mono break-all">
                  Meta error ({r.response.error.code}):{" "}
                  {r.response.error.message}
                </p>
              )}
              {r.error && <p className="font-mono break-all">{r.error}</p>}
              {senderWarning && (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-800">
                  ⚠️ {senderWarning}
                </div>
              )}
              {r.senderHealth && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-neutral-600 hover:text-neutral-900">
                    Saúde do remetente
                  </summary>
                  <pre className="mt-1 text-[10px] text-neutral-700">
                    {JSON.stringify(r.senderHealth, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
