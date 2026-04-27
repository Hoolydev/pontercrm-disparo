"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";

type Property = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  kind: string;
  transactionType: "sale" | "rent";
  priceCents: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpots: number | null;
  areaSqm: number | null;
  featuresJson: string[];
  addressJson: { neighborhood?: string; city?: string };
  photosJson: { url: string; caption?: string }[];
  active: boolean;
  createdAt: string;
};

const TX_LABEL: Record<string, string> = { sale: "Venda", rent: "Aluguel" };

export default function PropertiesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [tx, setTx] = useState("");
  const [creating, setCreating] = useState(false);

  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (tx) qs.set("transactionType", tx);

  const { data, isLoading } = useQuery({
    queryKey: ["properties", search, tx],
    queryFn: () => api.get<{ properties: Property[] }>(`/properties?${qs.toString()}`)
  });

  const [form, setForm] = useState({
    title: "",
    code: "",
    kind: "apartment",
    transactionType: "sale" as "sale" | "rent",
    bedrooms: "",
    bathrooms: "",
    parkingSpots: "",
    areaSqm: "",
    priceBrl: "",
    neighborhood: "",
    city: "",
    description: "",
    photoUrlsRaw: ""
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/properties", {
        title: form.title,
        code: form.code || null,
        kind: form.kind,
        transactionType: form.transactionType,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
        bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
        parkingSpots: form.parkingSpots ? Number(form.parkingSpots) : null,
        areaSqm: form.areaSqm ? Number(form.areaSqm) : null,
        priceCents: form.priceBrl ? Math.round(Number(form.priceBrl) * 100) : null,
        addressJson: { neighborhood: form.neighborhood || undefined, city: form.city || undefined },
        description: form.description || null,
        photosJson: form.photoUrlsRaw
          .split(/\s+/)
          .filter(Boolean)
          .map((u) => ({ url: u }))
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      setCreating(false);
      setForm({
        title: "",
        code: "",
        kind: "apartment",
        transactionType: "sale",
        bedrooms: "",
        bathrooms: "",
        parkingSpots: "",
        areaSqm: "",
        priceBrl: "",
        neighborhood: "",
        city: "",
        description: "",
        photoUrlsRaw: ""
      });
    }
  });

  const toggleMut = useMutation({
    mutationFn: (p: Property) =>
      api.patch(`/properties/${p.id}`, { active: !p.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] })
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/properties/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] })
  });

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Captação</h1>
          <p className="text-xs text-neutral-400">Catálogo de imóveis disponíveis</p>
        </div>
        <button
          onClick={() => setCreating((p) => !p)}
          className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {creating ? "Cancelar" : "Novo imóvel"}
        </button>
      </div>

      <div className="mb-4 flex gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar título, código, descrição…"
          className="w-72 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
        />
        <select
          value={tx}
          onChange={(e) => setTx(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pi-primary"
        >
          <option value="">Venda + Aluguel</option>
          <option value="sale">Venda</option>
          <option value="rent">Aluguel</option>
        </select>
      </div>

      {creating && (
        <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700">Novo imóvel</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Título" full>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Apto 2q Vila Madalena"
                className="input"
              />
            </Field>
            <Field label="Código">
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="AP-001"
                className="input"
              />
            </Field>
            <Field label="Tipo">
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                className="input"
              >
                <option value="apartment">Apartamento</option>
                <option value="house">Casa</option>
                <option value="commercial">Comercial</option>
                <option value="land">Terreno</option>
              </select>
            </Field>
            <Field label="Operação">
              <select
                value={form.transactionType}
                onChange={(e) =>
                  setForm({ ...form, transactionType: e.target.value as "sale" | "rent" })
                }
                className="input"
              >
                <option value="sale">Venda</option>
                <option value="rent">Aluguel</option>
              </select>
            </Field>
            <Field label="Quartos">
              <input
                type="number"
                value={form.bedrooms}
                onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Banheiros">
              <input
                type="number"
                value={form.bathrooms}
                onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Vagas">
              <input
                type="number"
                value={form.parkingSpots}
                onChange={(e) => setForm({ ...form, parkingSpots: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Área (m²)">
              <input
                type="number"
                value={form.areaSqm}
                onChange={(e) => setForm({ ...form, areaSqm: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Preço (R$)">
              <input
                type="number"
                value={form.priceBrl}
                onChange={(e) => setForm({ ...form, priceBrl: e.target.value })}
                placeholder="890000"
                className="input"
              />
            </Field>
            <Field label="Bairro">
              <input
                value={form.neighborhood}
                onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Cidade">
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Descrição" full>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="input"
              />
            </Field>
            <Field
              label="URLs de fotos (uma por linha — upload virá em breve)"
              hint="Por enquanto cole URLs públicas; depois vai ser upload direto"
              full
            >
              <textarea
                value={form.photoUrlsRaw}
                onChange={(e) => setForm({ ...form, photoUrlsRaw: e.target.value })}
                rows={3}
                placeholder="https://exemplo.com/foto1.jpg"
                className="input font-mono text-xs"
              />
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.title || createMut.isPending}
              className="rounded-lg bg-pi-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {createMut.isPending ? "Salvando…" : "Adicionar"}
            </button>
          </div>
          {createMut.isError && (
            <p className="mt-2 text-xs text-red-500">{createMut.error?.message}</p>
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
            }
          `}</style>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-neutral-400">Carregando…</p>
      ) : (data?.properties.length ?? 0) === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-12">
          Nenhum imóvel ainda. Crie o primeiro.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.properties.map((p) => (
            <div
              key={p.id}
              className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${
                p.active ? "border-neutral-200" : "border-neutral-100 opacity-60"
              }`}
            >
              {/* Hero photo */}
              {p.photosJson[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.photosJson[0].url}
                  alt={p.title}
                  className="w-full h-40 object-cover"
                />
              ) : (
                <div className="w-full h-40 bg-neutral-100 flex items-center justify-center text-neutral-400 text-xs">
                  sem foto
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-sm font-medium text-neutral-900 line-clamp-2">{p.title}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0 ${
                      p.transactionType === "sale"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {TX_LABEL[p.transactionType]}
                  </span>
                </div>
                {p.code && <p className="text-[10px] text-neutral-400 mb-2">{p.code}</p>}
                <div className="flex items-center gap-3 text-[11px] text-neutral-500 mb-2">
                  {p.bedrooms != null && <span>{p.bedrooms}q</span>}
                  {p.bathrooms != null && <span>{p.bathrooms}b</span>}
                  {p.areaSqm != null && <span>{p.areaSqm}m²</span>}
                  {p.parkingSpots != null && <span>{p.parkingSpots} vaga{p.parkingSpots !== 1 ? "s" : ""}</span>}
                </div>
                {(p.addressJson.neighborhood || p.addressJson.city) && (
                  <p className="text-[11px] text-neutral-400 mb-2">
                    {[p.addressJson.neighborhood, p.addressJson.city].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="text-base font-semibold text-neutral-900 mb-3">
                  {p.priceCents != null
                    ? `R$ ${(p.priceCents / 100).toLocaleString("pt-BR", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                      })}`
                    : "Consulte"}
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => toggleMut.mutate(p)}
                    className="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    {p.active ? "Inativar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Excluir imóvel?")) deleteMut.mutate(p.id);
                    }}
                    className="rounded-lg border border-red-100 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  full
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-3" : ""}>
      <label className="block text-xs font-medium text-neutral-600 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}
