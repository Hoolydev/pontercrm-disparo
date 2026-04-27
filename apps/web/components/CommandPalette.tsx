"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api } from "../lib/api";

type Result = {
  leads: { id: string; name: string | null; phone: string; email: string | null }[];
  conversations: {
    id: string;
    status: string;
    lastMessageAt: string | null;
    lead: { id: string; name: string | null; phone: string };
  }[];
};

const PAGES: Array<{ label: string; href: string; keywords: string[] }> = [
  { label: "Dashboard", href: "/app/dashboard", keywords: ["home", "overview", "kpi"] },
  { label: "Inbox", href: "/app/inbox", keywords: ["chat", "conversa"] },
  { label: "Leads", href: "/app/leads", keywords: ["clientes", "pipeline"] },
  { label: "Campanhas", href: "/app/campaigns", keywords: ["disparo", "outbound", "blast"] },
  { label: "Agendamentos", href: "/app/appointments", keywords: ["visita", "calendar"] },
  { label: "Cobranças (Followups)", href: "/app/followups", keywords: ["followup", "cobranca"] },
  { label: "Fila de Corretores", href: "/app/broker-queue", keywords: ["queue", "broker"] },
  { label: "Alertas de SLA", href: "/app/sla-alerts", keywords: ["sla", "stuck"] },
  { label: "Métricas", href: "/app/metrics", keywords: ["metrics", "stats"] },
  { label: "Agentes IA", href: "/app/agents", keywords: ["ai", "ia", "config"] },
  { label: "Funis (Pipelines)", href: "/app/pipelines", keywords: ["pipeline", "stage", "funil"] },
  { label: "Instâncias WhatsApp", href: "/app/instances", keywords: ["whatsapp", "qr"] },
  { label: "Triggers", href: "/app/triggers", keywords: ["handoff", "regra"] },
  { label: "Fontes de Lead", href: "/app/sources", keywords: ["webhook", "portal"] },
  { label: "Usuários", href: "/app/settings", keywords: ["users", "settings", "config"] }
];

export function CommandPalette({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setQ("");
      setActive(0);
    }
  }, [open]);

  // Backend search (only after 2 chars + debounce)
  const debounced = useDebounced(q, 180);
  const { data } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () =>
      debounced.trim().length >= 2
        ? api.get<Result>(`/search?q=${encodeURIComponent(debounced.trim())}`)
        : Promise.resolve({ leads: [], conversations: [] }),
    enabled: open && debounced.trim().length >= 2
  });

  const filteredPages = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return PAGES.slice(0, 6);
    return PAGES.filter(
      (p) =>
        p.label.toLowerCase().includes(t) ||
        p.keywords.some((k) => k.includes(t))
    ).slice(0, 6);
  }, [q]);

  // Flat list for keyboard navigation
  const flat = useMemo(() => {
    const items: Array<{
      kind: "page" | "lead" | "conversation";
      label: string;
      sub: string;
      href: string;
    }> = [];
    for (const p of filteredPages) {
      items.push({ kind: "page", label: p.label, sub: p.href, href: p.href });
    }
    for (const l of data?.leads ?? []) {
      items.push({
        kind: "lead",
        label: l.name ?? l.phone,
        sub: `${l.phone}${l.email ? ` · ${l.email}` : ""}`,
        href: `/app/leads/${l.id}`
      });
    }
    for (const c of data?.conversations ?? []) {
      items.push({
        kind: "conversation",
        label: `Conversa: ${c.lead.name ?? c.lead.phone}`,
        sub: c.status === "ai_active" ? "IA ativa" : c.status === "handed_off" ? "Com corretor" : "Fechada",
        href: `/app/inbox/${c.id}`
      });
    }
    return items;
  }, [filteredPages, data]);

  // Reset active when results change
  useEffect(() => {
    setActive(0);
  }, [flat.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        const item = flat[active];
        if (item) {
          router.push(item.href);
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, active, flat, router, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[#f0f2f5] px-5 py-3.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-400">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar leads, conversas, páginas…"
            className="flex-1 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 bg-transparent"
          />
          <kbd className="rounded-md border border-[#e8ecf2] bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] text-neutral-400">
            Esc
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto py-2">
          {flat.length === 0 ? (
            <p className="text-center text-sm text-neutral-400 py-8">
              {q.trim().length < 2 ? "Digite ≥ 2 caracteres para buscar." : "Nada encontrado."}
            </p>
          ) : (
            renderResults(flat, active, (href) => {
              router.push(href);
              onClose();
            })
          )}
        </div>

        <div className="border-t border-[#f0f2f5] px-4 py-2 flex items-center gap-3 text-[10px] text-neutral-400">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>Esc fechar</span>
        </div>
      </div>
    </div>
  );
}

function renderResults(
  flat: Array<{ kind: "page" | "lead" | "conversation"; label: string; sub: string; href: string }>,
  active: number,
  onPick: (href: string) => void
) {
  // Group by kind
  const groups: Record<string, typeof flat> = { page: [], lead: [], conversation: [] };
  for (const item of flat) groups[item.kind]!.push(item);

  const out: ReactElement[] = [];
  let idx = 0;
  for (const [kind, items] of Object.entries(groups)) {
    if (!items.length) continue;
    out.push(
      <p
        key={`h-${kind}`}
        className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide font-semibold text-neutral-400"
      >
        {kind === "page" ? "Páginas" : kind === "lead" ? "Leads" : "Conversas"}
      </p>
    );
    for (const item of items) {
      const isActive = idx === active;
      const myIdx = idx;
      out.push(
        <button
          key={`${kind}-${myIdx}`}
          onMouseEnter={() => {
            // setActive — but we'd need to lift state up; skipping for simplicity
          }}
          onClick={() => onPick(item.href)}
          className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${
            isActive ? "bg-pi-primary/10 text-pi-primary" : "text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{item.label}</p>
            <p className="truncate text-[11px] text-neutral-400">{item.sub}</p>
          </div>
          {isActive && <span className="text-[11px]">↵</span>}
        </button>
      );
      idx += 1;
    }
  }
  return out;
}

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
