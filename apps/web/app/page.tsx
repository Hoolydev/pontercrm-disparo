import Image from "next/image";
import Link from "next/link";
import {
  Search,
  MapPin,
  BedDouble,
  Bath,
  Car,
  ArrowRight,
  Mail,
  Phone,
  LogIn,
  ShieldCheck,
  Award,
  Users
} from "lucide-react";

const InstagramIcon = (props: { className?: string }) => (
  <svg className={props.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const FacebookIcon = (props: { className?: string }) => (
  <svg className={props.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const YoutubeIcon = (props: { className?: string }) => (
  <svg className={props.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
    <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
  </svg>
);
import {
  getFeaturedSale,
  getFeaturedRent,
  type FeaturedProperty
} from "../lib/featured-properties";

export const revalidate = 3600;

const LOGO_URL = "https://www.pointerimoveis.net.br/assets/img/logos/logo.webp";
const FOOTER_LOGO_URL = "https://www.pointerimoveis.net.br/assets/img/logos/footer-logo.webp";
const SITE_URL = "https://www.pointerimoveis.net.br";

function PropertyCard({ p }: { p: FeaturedProperty }) {
  const isRent = p.finalidade === "Aluguel";
  return (
    <a
      href={p.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100"
    >
      <div className="relative h-60 w-full overflow-hidden bg-gray-100">
        <Image
          src={p.foto}
          alt={p.tipo + " em " + p.bairro}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          unoptimized
        />
        <div
          className={
            "absolute top-4 left-4 backdrop-blur px-3 py-1 rounded-full text-xs font-semibold shadow-sm " +
            (isRent ? "bg-blue-600 text-white" : "bg-white/90 text-blue-700")
          }
        >
          {p.finalidade}
        </div>
        <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur text-white px-3 py-1 rounded-full text-xs font-medium">
          {p.tipo}
        </div>
      </div>
      <div className="p-6">
        <div className="text-2xl font-bold text-slate-900 mb-1">
          {p.valor}
          {isRent ? <span className="text-sm font-normal text-slate-500"> /mês</span> : null}
        </div>
        {p.valorCondominio && p.valorCondominio !== "R$ 0,00" && p.valorCondominio !== "R$ 0,01" ? (
          <div className="text-xs text-slate-500 mb-2">Condomínio: {p.valorCondominio}</div>
        ) : (
          <div className="h-4" />
        )}
        <h3 className="text-base font-semibold text-slate-800 mb-2 line-clamp-2 capitalize">
          {p.titulo.replace(/-/g, " ")}
        </h3>
        <p className="text-slate-500 flex items-center gap-1 text-sm mb-5">
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {p.bairro}, {p.cidade} - {p.estado}
          </span>
        </p>
        <div className="flex items-center gap-4 border-t border-gray-100 pt-4 text-slate-600 text-sm">
          {p.quartos > 0 && (
            <div className="flex items-center gap-1.5" title="Quartos">
              <BedDouble className="h-4 w-4" /> {p.quartos}
            </div>
          )}
          {p.banhos > 0 && (
            <div className="flex items-center gap-1.5" title="Banheiros">
              <Bath className="h-4 w-4" /> {p.banhos}
            </div>
          )}
          {p.vagas > 0 && (
            <div className="flex items-center gap-1.5" title="Vagas">
              <Car className="h-4 w-4" /> {p.vagas}
            </div>
          )}
          <div className="ml-auto font-medium">
            {p.area} {p.medida}
          </div>
        </div>
      </div>
    </a>
  );
}

export default async function Home() {
  const [sale, rent] = await Promise.all([getFeaturedSale(), getFeaturedRent()]);
  const featured: FeaturedProperty[] = [...sale.slice(0, 3), ...rent.slice(0, 3)];

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-50">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3">
              <Image
                src={LOGO_URL}
                alt="Pointer Imóveis"
                width={160}
                height={48}
                className="h-10 w-auto object-contain"
                unoptimized
                priority
              />
            </a>

            <nav className="hidden md:flex items-center gap-7">
              <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Home</a>
              <a href={`${SITE_URL}/imoveis`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Buscar Imóveis</a>
              <a href={`${SITE_URL}/sobre`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Sobre</a>
              <a href={`${SITE_URL}/contato`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Contato</a>
            </nav>

            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="hidden sm:inline-flex items-center gap-2 rounded-md text-sm font-semibold transition-colors bg-blue-600 text-white shadow hover:bg-blue-700 h-10 px-5"
              >
                <LogIn className="h-4 w-4" />
                Acessar CRM
              </Link>
              <Link
                href="/login"
                className="sm:hidden inline-flex items-center justify-center rounded-md text-sm font-semibold bg-blue-600 text-white h-10 w-10"
                aria-label="Acessar CRM"
              >
                <LogIn className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative min-h-[620px] w-full flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <Image
            src="/images/hero_bg.png"
            alt="Imóveis em Goiânia"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/70 via-slate-900/55 to-slate-900/80" />
        </div>

        <div className="relative z-10 w-full max-w-5xl mx-auto px-4 py-20 text-center">
          <span className="inline-block bg-blue-600/90 text-white text-xs font-semibold px-4 py-1.5 rounded-full mb-6 tracking-wide">
            CRECI 26280 · Goiânia · GO
          </span>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 drop-shadow-md leading-tight">
            Encontre o imóvel certo<br className="hidden md:block" /> com a Pointer Imóveis
          </h1>
          <p className="text-lg md:text-xl text-white/90 mb-10 max-w-2xl mx-auto drop-shadow">
            Compra, venda e locação em Goiânia e região. Atendimento próximo, curadoria de oportunidades e suporte do início ao fim.
          </p>

          <div className="bg-white p-2 rounded-full shadow-2xl flex items-center max-w-3xl mx-auto">
            <div className="flex-1 flex items-center px-4 border-r border-gray-200">
              <MapPin className="h-5 w-5 text-gray-400 mr-2 shrink-0" />
              <input
                type="text"
                placeholder="Cidade, bairro ou código do imóvel"
                className="w-full bg-transparent border-none outline-none text-slate-700 placeholder:text-gray-400 h-12 text-sm"
              />
            </div>
            <a
              href={`${SITE_URL}/imoveis`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-8 py-3 h-12 font-medium transition flex items-center gap-2 ml-2 shrink-0"
            >
              <Search className="h-4 w-4" />
              Buscar
            </a>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-white/80 text-sm">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-300" /> Tradição no mercado</div>
            <div className="flex items-center gap-2"><Award className="h-4 w-4 text-blue-300" /> Curadoria de imóveis</div>
            <div className="flex items-center gap-2"><Users className="h-4 w-4 text-blue-300" /> Equipe especializada</div>
          </div>
        </div>
      </section>

      {/* CRM CTA strip */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-white">
            <p className="font-semibold text-lg">Equipe Pointer</p>
            <p className="text-blue-100 text-sm">Acesse o painel interno para gestão de leads, conversas e funil.</p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 bg-white text-blue-700 hover:bg-blue-50 transition font-semibold px-6 py-3 rounded-lg shadow-md"
          >
            <LogIn className="h-5 w-5" />
            Entrar no Sistema
          </Link>
        </div>
      </section>

      {/* Properties */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-12">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 mb-2">Imóveis em Destaque</h2>
              <p className="text-slate-600">
                Seleção atualizada do nosso portfólio em Goiânia.
              </p>
            </div>
            <a
              href={`${SITE_URL}/imoveis`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-blue-600 font-medium hover:text-blue-700"
            >
              Ver todos os imóveis <ArrowRight className="h-4 w-4 ml-1" />
            </a>
          </div>

          {featured.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {featured.map((p) => (
                <PropertyCard key={`${p.finalidade}-${p.codigo}`} p={p} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
              <p className="text-slate-600">
                Não foi possível carregar os imóveis em destaque agora.{" "}
                <a className="text-blue-600 font-medium" href={`${SITE_URL}/imoveis`} target="_blank" rel="noopener noreferrer">
                  Ver no site
                </a>
                .
              </p>
            </div>
          )}
        </div>
      </section>

      {/* About */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 mb-6">
                Tradição e atendimento próximo no mercado imobiliário
              </h2>
              <p className="text-slate-600 text-lg mb-4 leading-relaxed">
                A Pointer Imóveis atua em Goiânia e região com foco em tornar o processo de compra, venda e locação simples, transparente e seguro.
              </p>
              <p className="text-slate-600 text-lg mb-8 leading-relaxed">
                Nosso time entende as particularidades de cada bairro e ajuda você a encontrar o imóvel certo — seja para morar, investir ou alugar.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href={`${SITE_URL}/sobre`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-blue-600 text-white h-11 px-8 hover:bg-blue-700 transition"
                >
                  Conheça a empresa
                </a>
                <a
                  href={`${SITE_URL}/contato`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-gray-300 bg-white text-slate-700 h-11 px-8 hover:bg-gray-50 transition"
                >
                  Fale com um corretor
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                <div className="text-3xl font-bold text-blue-700 mb-1">+15</div>
                <p className="text-sm text-slate-600">anos de mercado</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                <div className="text-3xl font-bold text-blue-700 mb-1">Goiânia</div>
                <p className="text-sm text-slate-600">e região metropolitana</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                <div className="text-3xl font-bold text-blue-700 mb-1">Curadoria</div>
                <p className="text-sm text-slate-600">imóveis selecionados</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                <div className="text-3xl font-bold text-blue-700 mb-1">Equipe</div>
                <p className="text-sm text-slate-600">corretores experientes</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 py-16 border-t border-slate-800 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            <div className="col-span-1 md:col-span-1">
              <Image
                src={FOOTER_LOGO_URL}
                alt="Pointer Imóveis"
                width={160}
                height={48}
                className="h-12 w-auto object-contain mb-6 brightness-0 invert"
                unoptimized
              />
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                Especialistas no mercado imobiliário de Goiânia e região.
              </p>
              <div className="flex gap-4">
                <a href="https://www.instagram.com/pointerimoveis/" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition" aria-label="Instagram"><InstagramIcon className="h-5 w-5" /></a>
                <a href="https://www.facebook.com/PointerImoveiss" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition" aria-label="Facebook"><FacebookIcon className="h-5 w-5" /></a>
                <a href="https://www.youtube.com/@pointerimoveis3645" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition" aria-label="YouTube"><YoutubeIcon className="h-5 w-5" /></a>
              </div>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Acesso Rápido</h3>
              <ul className="space-y-3 text-sm">
                <li><a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition">Home</a></li>
                <li><a href={`${SITE_URL}/imoveis`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition">Buscar Imóveis</a></li>
                <li><a href={`${SITE_URL}/sobre`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition">Sobre a Empresa</a></li>
                <li><a href={`${SITE_URL}/anuncie`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition">Anuncie seu Imóvel</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Equipe Pointer</h3>
              <ul className="space-y-3 text-sm">
                <li>
                  <Link href="/login" className="inline-flex items-center gap-2 hover:text-blue-400 transition">
                    <LogIn className="h-4 w-4" /> Acessar CRM
                  </Link>
                </li>
                <li><a href="http://www.portalunsoft.com.br/area-do-cliente/pointer" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition">Área do Cliente</a></li>
                <li><a href={`${SITE_URL}/politica-de-privacidade`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition">Política de Privacidade</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Contato</h3>
              <ul className="space-y-4 text-sm">
                <li className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                  <span>Ed. Walk Bueno Business<br />R. T-55, 930 - sala 1301<br />St. Bueno, Goiânia - GO</span>
                </li>
                <li className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-blue-500 shrink-0" />
                  <span>(62) 3626-9349<br />(62) 98159-4505</span>
                </li>
                <li className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-blue-500 shrink-0" />
                  <a href="mailto:wictormachado.pointer@gmail.com" className="hover:text-blue-400 transition break-all">wictormachado.pointer@gmail.com</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-16 pt-8 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-slate-500">
            <p>CRECI 26280 &nbsp;|&nbsp; &copy; {new Date().getFullYear()} Pointer Imóveis. Todos os direitos reservados.</p>
            <p>Goiânia · GO</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
