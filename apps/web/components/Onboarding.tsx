"use client";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

const SEEN_KEY = "pointer_onboarding_seen_v1";

type Slide = {
  tag: string;
  title: string;
  description: string;
  bg: string;
  accent: string;
  Visual: () => ReactElement;
};

const SLIDES: Slide[] = [
  {
    tag: "Bem-vindo",
    title: "Pointer Imóveis",
    description:
      "Captação, qualificação e distribuição de leads imobiliários via WhatsApp com IA. Vamos te mostrar o que ele faz em 1 minuto.",
    bg: "from-[#157aff] to-[#0046a8]",
    accent: "#157aff",
    Visual: WelcomeOrbit
  },
  {
    tag: "Captação",
    title: "Leads de qualquer canal",
    description:
      "Webhook estilo ZAP/VivaReal/OLX, formulário do site, Meta Ads e Google Ads. Tudo cai no inbox unificado.",
    bg: "from-[#7c3aed] to-[#3b0764]",
    accent: "#7c3aed",
    Visual: SourcesBars
  },
  {
    tag: "Agente IA",
    title: "Atendimento 24/7 humanizado",
    description:
      "Agente outbound faz a primeira abordagem; agente inbound qualifica e responde dúvidas. Quando o lead esquenta, transfere pro corretor.",
    bg: "from-[#157aff] to-[#1e40af]",
    accent: "#157aff",
    Visual: ChatBubbles
  },
  {
    tag: "CRM",
    title: "Funil arrastável + cobranças automáticas",
    description:
      "Pipeline configurável, drag-and-drop entre estágios, follow-up de cobrança em 5 etapas, redistribuição automática se o corretor não responde.",
    bg: "from-[#31ba96] to-[#065f46]",
    accent: "#31ba96",
    Visual: KanbanColumns
  },
  {
    tag: "Pronto!",
    title: "Tudo integrado",
    description:
      "Disparo em massa, scoring de leads, alertas de SLA, notificações operacionais, exportação CSV. Você só configura o agente — o resto é automático.",
    bg: "from-[#f59e0b] to-[#92400e]",
    accent: "#f59e0b",
    Visual: ChecklistPulse
  }
];

export function Onboarding({
  onClose
}: {
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") complete();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  function next() {
    if (idx === SLIDES.length - 1) complete();
    else setIdx((i) => i + 1);
  }
  function prev() {
    setIdx((i) => Math.max(0, i - 1));
  }
  function complete() {
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {}
    onClose();
  }

  const slide = SLIDES[idx]!;
  const progress = ((idx + 1) / SLIDES.length) * 100;

  return (
    <div className="fixed inset-0 z-[60] bg-pi-bg flex flex-col">
      {/* Top progress bar */}
      <div className="h-1 bg-white/5">
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%`, background: slide.accent }}
        />
      </div>

      {/* Skip button */}
      <button
        onClick={complete}
        className="absolute top-4 right-5 text-xs text-white/40 hover:text-white/80 transition-colors z-10"
      >
        Pular introdução
      </button>

      {/* Slide content */}
      <div className={`flex-1 bg-gradient-to-br ${slide.bg} relative overflow-hidden`}>
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-8 text-center">
          <span
            className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider mb-6 backdrop-blur-md"
            style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
          >
            {slide.tag}
          </span>

          <div className="mb-8 h-64 w-full flex items-center justify-center">
            <slide.Visual />
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 max-w-2xl tracking-tight">
            {slide.title}
          </h2>
          <p className="text-base text-white/80 max-w-xl leading-relaxed">{slide.description}</p>
        </div>

        {/* Decorative blurred orbs */}
        <div
          className="absolute -top-20 -right-20 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ background: slide.accent }}
        />
        <div
          className="absolute -bottom-20 -left-20 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ background: slide.accent }}
        />
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between px-8 py-5 bg-pi-bg border-t border-white/[0.06]">
        <button
          onClick={prev}
          disabled={idx === 0}
          className="text-sm text-white/45 hover:text-white disabled:opacity-30 transition-colors"
        >
          ← Voltar
        </button>

        <div className="flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-8 bg-white" : "w-1.5 bg-white/25 hover:bg-white/50"
              }`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="rounded-lg bg-white text-pi-bg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          {idx === SLIDES.length - 1 ? "Começar 🎉" : "Próximo →"}
        </button>
      </div>

      <style jsx>{`
        @keyframes orbit-cw {
          from { transform: rotate(0deg) translateX(110px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(110px) rotate(-360deg); }
        }
        @keyframes orbit-ccw {
          from { transform: rotate(0deg) translateX(140px) rotate(0deg); }
          to   { transform: rotate(-360deg) translateX(140px) rotate(360deg); }
        }
        @keyframes fillBar {
          from { width: 0%; opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes columnDrop {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes checkPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes badgePop {
          from { transform: scale(0); opacity: 0; }
          50%  { transform: scale(1.2); }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function maybeShowOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !localStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
}

export function resetOnboardingFlag() {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {}
}

// ── Visuals ──────────────────────────────────────────────────────────────

function WelcomeOrbit() {
  // Logo at center; 6 small property cards orbiting
  return (
    <div className="relative w-64 h-64">
      {/* Center logo */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-20 w-20 rounded-2xl bg-white shadow-2xl flex items-center justify-center">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#157aff" strokeWidth="2.5">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
      </div>
      {/* Orbiting cards */}
      {Array.from({ length: 6 }).map((_, i) => {
        const cw = i % 2 === 0;
        const delay = -(i * (cw ? 12 / 6 : 16 / 6));
        return (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 w-12 h-9 rounded-md bg-white/90 shadow-lg flex items-center justify-center"
            style={{
              transform: "translate(-50%, -50%)",
              animation: `${cw ? "orbit-cw" : "orbit-ccw"} ${cw ? "12s" : "16s"} linear infinite`,
              animationDelay: `${delay}s`
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#157aff" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function SourcesBars() {
  const sources = [
    { name: "Meta Ads", pct: 88, color: "#1877f2" },
    { name: "Zap Imóveis", pct: 64, color: "#ed1c24" },
    { name: "Google Ads", pct: 52, color: "#fbbc05" },
    { name: "Site Pointer", pct: 38, color: "#10b981" },
    { name: "OLX", pct: 24, color: "#7e22ce" }
  ];
  return (
    <div className="w-full max-w-md space-y-2.5">
      {sources.map((s, i) => (
        <div
          key={s.name}
          className="rounded-lg bg-white/10 backdrop-blur-sm overflow-hidden"
          style={{ animation: `slideUp .45s ease-out both`, animationDelay: `${i * 90}ms` }}
        >
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-white">
            <span className="font-medium">{s.name}</span>
            <span className="text-white/70">{s.pct}%</span>
          </div>
          <div className="h-1.5 bg-white/10">
            <div
              className="h-full rounded-r-full"
              style={{
                background: s.color,
                width: `${s.pct}%`,
                animation: `fillBar 1.4s ease-out both`,
                animationDelay: `${i * 90 + 200}ms`
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatBubbles() {
  const msgs = [
    { from: "lead", text: "Vi o apto na Paulista, ainda disponível?" },
    { from: "ai", text: "Olá! Sim 😊 — 85m², 2 dorm, R$ 890k. Quer agendar visita?" },
    { from: "lead", text: "Pode ser amanhã 14h?" },
    { from: "ai", text: "Confirmado! Vou transferir pra você falar direto com o corretor." }
  ];
  return (
    <div className="w-full max-w-sm space-y-2">
      {msgs.map((m, i) => {
        const isLead = m.from === "lead";
        return (
          <div
            key={i}
            className={`flex ${isLead ? "justify-start" : "justify-end"}`}
            style={{ animation: `slideUp .5s ease-out both`, animationDelay: `${i * 350}ms` }}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs ${
                isLead
                  ? "bg-white text-neutral-800"
                  : "bg-pi-primary text-white"
              }`}
              style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
            >
              {m.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanColumns() {
  const cols = [
    { name: "Novo", count: 12, color: "#94a3b8" },
    { name: "Em conversa", count: 8, color: "#3b82f6" },
    { name: "Qualificado", count: 5, color: "#8b5cf6" },
    { name: "Visita", count: 3, color: "#f59e0b" },
    { name: "Ganho", count: 2, color: "#22c55e" }
  ];
  return (
    <div className="flex gap-2 max-w-2xl">
      {cols.map((c, i) => (
        <div
          key={c.name}
          className="w-24 rounded-lg bg-white/10 backdrop-blur-sm p-2"
          style={{ animation: `columnDrop .55s ease-out both`, animationDelay: `${i * 110}ms` }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
            <span className="text-[10px] font-semibold text-white truncate">{c.name}</span>
          </div>
          <div className="space-y-1">
            {Array.from({ length: Math.min(3, c.count) }).map((_, j) => (
              <div key={j} className="h-6 rounded bg-white/15" />
            ))}
            <p className="text-[9px] text-white/50 text-center pt-0.5">{c.count}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChecklistPulse() {
  const items = [
    "Disparo outbound em massa",
    "Cobranças automáticas em 5 etapas",
    "Distribuição com timeout 15min",
    "Scoring + decay progressivo",
    "Alertas de SLA por estágio"
  ];
  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-4">
        <div
          className="text-6xl inline-block"
          style={{ animation: "checkPulse 1.6s ease-in-out infinite" }}
        >
          🎉
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={item}
            className="flex items-center gap-2.5 rounded-lg bg-white/10 backdrop-blur-sm px-3 py-2"
            style={{ animation: `slideUp .4s ease-out both`, animationDelay: `${i * 150}ms` }}
          >
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-pi-bg text-[12px] font-bold"
              style={{ animation: `badgePop .4s ease-out both`, animationDelay: `${i * 150 + 200}ms` }}
            >
              ✓
            </span>
            <span className="text-xs text-white">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
