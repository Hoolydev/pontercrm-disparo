"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Mail, ArrowRight, ShieldCheck, Building2, MapPin, Phone } from "lucide-react";
import { setToken } from "../../lib/session";

const LOGO_URL = "https://www.pointerimoveis.net.br/assets/img/logos/logo.webp";

const LockIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const EyeIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const SparklesIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
    <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
  </svg>
);
const InboxIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);
const PipelineIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="6" height="18" rx="1" />
    <rect x="11" y="3" width="6" height="14" rx="1" />
    <rect x="19" y="3" width="2" height="9" rx="1" />
  </svg>
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as any).message ?? "Credenciais inválidas");
        return;
      }
      const data = await res.json();
      const token = data.token as string | undefined;
      if (!token) {
        setError("Resposta inválida do servidor");
        return;
      }
      setToken(token);
      router.push("/app/inbox");
    } catch {
      setError("Erro de conexão — verifique se a API está rodando");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-slate-50">
      {/* ── Brand panel ──────────────────────────────────── */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 p-12 text-white">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-[28rem] w-[28rem] translate-x-1/3 translate-y-1/3 rounded-full bg-blue-400/10 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "44px 44px"
          }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <div className="bg-white/10 backdrop-blur rounded-xl p-2 border border-white/10">
            <Image
              src={LOGO_URL}
              alt="Pointer Imóveis"
              width={140}
              height={42}
              className="h-9 w-auto object-contain"
              unoptimized
              priority
            />
          </div>
        </div>

        <div className="relative z-10 max-w-md">
          <span className="inline-flex items-center gap-2 bg-white/10 backdrop-blur border border-white/15 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Painel interno · Equipe Pointer
          </span>
          <h1 className="text-4xl font-bold leading-tight mb-5">
            Bem-vindo de volta ao CRM da Pointer Imóveis.
          </h1>
          <p className="text-blue-100/80 text-lg leading-relaxed mb-10">
            Gerencie leads, conversas no WhatsApp e o funil completo da equipe em um só lugar.
          </p>

          <ul className="space-y-5">
            <li className="flex gap-4">
              <div className="shrink-0 h-11 w-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                <InboxIcon className="h-5 w-5 text-blue-200" />
              </div>
              <div>
                <p className="font-semibold">Inbox unificada</p>
                <p className="text-sm text-blue-100/70">Conversas do WhatsApp em tempo real, com histórico e atribuição de corretor.</p>
              </div>
            </li>
            <li className="flex gap-4">
              <div className="shrink-0 h-11 w-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                <SparklesIcon className="h-5 w-5 text-blue-200" />
              </div>
              <div>
                <p className="font-semibold">Agentes de IA</p>
                <p className="text-sm text-blue-100/70">Qualificação automática, agendamento de visitas e envio de fichas de imóvel.</p>
              </div>
            </li>
            <li className="flex gap-4">
              <div className="shrink-0 h-11 w-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                <PipelineIcon className="h-5 w-5 text-blue-200" />
              </div>
              <div>
                <p className="font-semibold">Funil de vendas</p>
                <p className="text-sm text-blue-100/70">Acompanhe cada lead do primeiro contato à proposta — sem perder nada.</p>
              </div>
            </li>
          </ul>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-blue-100/60">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>Acesso restrito · CRECI 26280</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" />
            <span>Goiânia · GO</span>
          </div>
        </div>
      </aside>

      {/* ── Form panel ───────────────────────────────────── */}
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        {/* Mobile brand header */}
        <div className="lg:hidden flex items-center justify-between mb-10">
          <Image
            src={LOGO_URL}
            alt="Pointer Imóveis"
            width={140}
            height={42}
            className="h-10 w-auto object-contain"
            unoptimized
          />
          <Link href="/" className="text-sm text-slate-500 hover:text-blue-600 transition flex items-center gap-1">
            <ArrowRight className="h-4 w-4 -scale-x-100" />
            Site
          </Link>
        </div>

        <div className="w-full max-w-md mx-auto">
          <div className="mb-10">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-3 py-1 rounded-full mb-4">
              <Building2 className="h-3.5 w-3.5" />
              Pointer CRM
            </span>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">
              Acessar o sistema
            </h2>
            <p className="text-slate-500">
              Entre com as credenciais da sua conta da equipe Pointer.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                E-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="voce@pointerimoveis.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                  Senha
                </label>
                <a
                  href="#"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  onClick={(e) => e.preventDefault()}
                >
                  Esqueceu a senha?
                </a>
              </div>
              <div className="relative">
                <LockIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 rounded-lg border border-slate-300 bg-white pl-10 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">!</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Entrando…
                </>
              ) : (
                <>
                  Entrar no sistema
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-slate-200">
            <p className="text-center text-xs text-slate-500">
              Não é da equipe?{" "}
              <Link href="/" className="font-medium text-blue-600 hover:text-blue-700">
                Voltar para o site
              </Link>
            </p>
          </div>

          <div className="hidden lg:flex mt-10 items-center justify-center gap-6 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Phone className="h-3 w-3" />
              (62) 3626-9349
            </span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>CRECI 26280</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>© {new Date().getFullYear()} Pointer</span>
          </div>
        </div>
      </main>
    </div>
  );
}
