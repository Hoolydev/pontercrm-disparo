export type FeaturedProperty = {
  codigo: number;
  titulo: string;
  finalidade: "Venda" | "Aluguel";
  tipo: string;
  valor: string;
  valorCondominio?: string;
  bairro: string;
  cidade: string;
  estado: string;
  quartos: number;
  suites: number;
  banhos: number;
  vagas: number;
  area: string;
  medida: string;
  foto: string;
  link: string;
};

const SITE = "https://www.pointerimoveis.net.br";
const ENDPOINT = `${SITE}/imoveis/destaqueAjax/`;

const baseForm = {
  "imovel[opcaoimovel]": "1",
  "imovel[codigoTipo]": "imoveis",
  "imovel[codigocidade]": "todas-as-cidades",
  "imovel[codigosbairros]": "todos-os-bairros",
  "imovel[numeroquartos]": "0-quartos",
  "imovel[numerovagas]": "0-vaga",
  "imovel[numerobanhos]": "0-banheiro-ou-mais",
  "imovel[numerosuite]": "0-suite-ou-mais",
  "imovel[numeropagina]": "1",
  "imovel[numeroregistros]": "12"
};

function toInt(v: unknown): number {
  const n = parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

function normalize(item: Record<string, unknown>, finalidade: "Venda" | "Aluguel"): FeaturedProperty {
  const codigo = toInt(item.codigo);
  const slug = String(item.titulo ?? "").trim();
  return {
    codigo,
    titulo: slug,
    finalidade,
    tipo: String(item.tipo ?? ""),
    valor: String(item.valor ?? ""),
    valorCondominio: item.valorcondominio ? String(item.valorcondominio) : undefined,
    bairro: String(item.bairro ?? ""),
    cidade: String(item.cidade ?? ""),
    estado: String(item.estado ?? ""),
    quartos: toInt(item.numeroquartos),
    suites: toInt(item.numerosuites),
    banhos: toInt(item.numerobanhos),
    vagas: toInt(item.numerovagas),
    area: String(item.areaprincipal ?? "0"),
    medida: String(item.tipomedida ?? "m²"),
    foto: String(item.urlfotoprincipalp ?? item.urlfotoprincipal ?? ""),
    link: `${SITE}/imovel/${slug}/${codigo}`
  };
}

async function fetchByFinalidade(
  finalidade: "venda" | "aluguel",
  destaque: "0" | "2"
): Promise<FeaturedProperty[]> {
  const body = new URLSearchParams({
    ...baseForm,
    "imovel[finalidade]": finalidade,
    "imovel[destaque]": destaque
  });
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: SITE,
        "User-Agent": "Mozilla/5.0 (PointerCRM)"
      },
      body,
      next: { revalidate: 3600 }
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { lista?: Record<string, unknown>[] };
    const labelFinalidade = finalidade === "venda" ? "Venda" : "Aluguel";
    return (data.lista ?? [])
      .map((it) => normalize(it, labelFinalidade))
      .filter((p) => p.foto && p.codigo > 0);
  } catch {
    return [];
  }
}

export async function getFeaturedSale(): Promise<FeaturedProperty[]> {
  const items = await fetchByFinalidade("venda", "2");
  return items.length > 0 ? items.slice(0, 6) : items;
}

export async function getFeaturedRent(): Promise<FeaturedProperty[]> {
  const items = await fetchByFinalidade("aluguel", "0");
  return items.slice(0, 6);
}
