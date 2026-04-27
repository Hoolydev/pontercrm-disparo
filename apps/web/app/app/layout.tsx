"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode, SVGProps } from "react";
import { CommandPalette } from "../../components/CommandPalette";
import { NotificationsBell } from "../../components/NotificationsBell";
import { Onboarding, maybeShowOnboarding } from "../../components/Onboarding";
import { clearToken } from "../../lib/session";
import { useSession } from "../../lib/use-session";

type NavItemDef = {
  href: string;
  label: string;
  Icon: (p: SVGProps<SVGSVGElement>) => ReactElement;
};

const NAV: NavItemDef[] = [
  { href: "/app/dashboard", label: "Dashboard", Icon: IconDashboard },
  { href: "/app/inbox", label: "Inbox", Icon: IconInbox },
  { href: "/app/leads", label: "CRM", Icon: IconLeads },
  { href: "/app/campaigns", label: "Campanhas", Icon: IconCampaigns },
  { href: "/app/appointments", label: "Agendamentos", Icon: IconAppointments },
  { href: "/app/properties", label: "Captação", Icon: IconProperties }
];

const OPS_NAV: NavItemDef[] = [
  { href: "/app/followups", label: "Cobranças", Icon: IconFollowups },
  { href: "/app/broker-queue", label: "Fila Corretor", Icon: IconBrokerQueue },
  { href: "/app/sla-alerts", label: "Alertas SLA", Icon: IconAlerts }
];

const ADMIN_NAV: NavItemDef[] = [
  { href: "/app/agents", label: "Agentes", Icon: IconAgents },
  { href: "/app/pipelines", label: "Funis", Icon: IconPipelines },
  { href: "/app/instances", label: "Instâncias", Icon: IconInstances },
  { href: "/app/triggers", label: "Triggers", Icon: IconTriggers },
  { href: "/app/sources", label: "Fontes", Icon: IconSources },
  { href: "/app/settings", label: "Usuários", Icon: IconUsers }
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    if (session !== "loading" && !session) router.replace("/login");
  }, [session, router]);

  // First-visit onboarding (localStorage flag prevents repeat)
  useEffect(() => {
    if (maybeShowOnboarding()) setOnboardingOpen(true);
  }, []);

  // Auto-collapse on small viewports (Pointer Imoveis.html spec)
  useEffect(() => {
    function check() {
      if (window.innerWidth < 900) setCollapsed(true);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Cmd+K / Ctrl+K global hotkey
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (session === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pi-bg text-sm text-white/40">
        Carregando…
      </div>
    );
  }
  if (!session) return null;

  const isAdmin = session.role === "admin";
  const isSupervisor = session.role === "supervisor" || isAdmin;

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="pi-shell">
      <aside
        className="pi-sidebar-wrap flex flex-col h-full overflow-hidden"
        style={{
          width: collapsed ? 58 : 220,
          padding: collapsed ? "0 6px" : "0 10px"
        }}
      >
        {/* Logo + collapse toggle */}
        <div
          className="flex items-center"
          style={{
            padding: collapsed ? "22px 0 16px" : "22px 8px 16px",
            justifyContent: collapsed ? "center" : "space-between"
          }}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-pi-primary"
              title="Expandir menu"
            >
              <BrandGlyph />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pi-primary">
                  <BrandGlyph />
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-bold text-white tracking-tight">Pointer</div>
                  <div className="text-[10px] font-medium text-pi-primary -mt-0.5">Imóveis</div>
                </div>
              </div>
              <button
                onClick={() => setCollapsed(true)}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-white/40 hover:text-white"
                title="Recolher"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* User card */}
        {!collapsed && (
          <div className="mb-4 rounded-xl bg-white/[0.07] px-3 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pi-primary to-blue-900 text-sm font-bold text-white">
                {(session.role[0] || "?").toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">
                  {session.role.charAt(0).toUpperCase() + session.role.slice(1)}
                </p>
                <p className="text-[10px] text-white/40 truncate">
                  {session.userId.slice(0, 8)}…
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
          {NAV.map((n) => (
            <SidebarLink
              key={n.href}
              {...n}
              collapsed={collapsed}
              active={pathname.startsWith(n.href)}
            />
          ))}
          {isSupervisor && (
            <div className="mt-5 pt-4 border-t border-white/[0.08]">
              {!collapsed && (
                <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">
                  Operação
                </p>
              )}
              {OPS_NAV.map((n) => (
                <SidebarLink
                  key={n.href}
                  {...n}
                  collapsed={collapsed}
                  active={pathname.startsWith(n.href)}
                />
              ))}
            </div>
          )}
          {isSupervisor && (
            <div className="mt-5 pt-4 border-t border-white/[0.08]">
              {!collapsed && (
                <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">
                  Admin
                </p>
              )}
              {(isAdmin ? ADMIN_NAV : []).map((n) => (
                <SidebarLink
                  key={n.href}
                  {...n}
                  collapsed={collapsed}
                  active={pathname.startsWith(n.href)}
                />
              ))}
              <SidebarLink
                href="/app/metrics"
                label="Métricas"
                Icon={IconMetrics}
                collapsed={collapsed}
                active={pathname.startsWith("/app/metrics")}
              />
            </div>
          )}
        </nav>

        {/* Notifications + Footer actions */}
        <div className="pb-4 flex flex-col gap-1">
          <NotificationsBell collapsed={collapsed} />
          {!collapsed && (
            <>
              <button
                onClick={() => setOnboardingOpen(true)}
                className="w-full rounded-xl border border-white/[0.08] bg-transparent px-3 py-2 text-xs font-medium text-white/40 hover:bg-white/5 hover:text-white/70 mt-1"
              >
                Ver introdução
              </button>
              <button
                onClick={logout}
                className="w-full rounded-xl border border-white/[0.12] bg-transparent px-3 py-2 text-xs font-medium text-white/45 hover:bg-white/5"
              >
                Sair
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Floating content card */}
      <div className="pi-content-card">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-[#f0f2f5] bg-white px-5 py-2.5 flex-shrink-0">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex flex-1 max-w-sm items-center gap-2.5 rounded-lg border border-[#e8ecf2] bg-[#f9fafb] px-3.5 py-2 text-[12px] text-neutral-400 hover:bg-neutral-100 transition-colors"
            title="Buscar (⌘K)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <span>Buscar leads, conversas, páginas…</span>
            <kbd className="ml-auto rounded-md border border-[#e8ecf2] bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] text-neutral-300">
              ⌘K
            </kbd>
          </button>

          <div className="ml-4 flex items-center gap-2">
            <Link
              href="/app/metrics"
              className={`flex items-center gap-1.5 rounded-lg border border-[#e8ecf2] px-3 py-1.5 text-xs font-semibold transition-colors ${
                pathname.startsWith("/app/metrics")
                  ? "bg-[#eff6ff] text-pi-primary"
                  : "bg-[#f9fafb] text-neutral-500 hover:bg-neutral-100"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6" />
              </svg>
              Métricas
            </Link>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">{children}</div>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      {onboardingOpen && <Onboarding onClose={() => setOnboardingOpen(false)} />}
    </div>
  );
}

function SidebarLink({
  href,
  label,
  Icon,
  active,
  collapsed
}: NavItemDef & { active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center rounded-xl text-[13px] transition-colors ${
        active
          ? "bg-[rgba(21,122,255,0.18)] text-pi-primary font-semibold"
          : "text-white/65 hover:bg-white/[0.06]"
      }`}
      style={{
        padding: collapsed ? "10px 0" : "9px 12px",
        gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? "center" : "flex-start"
      }}
    >
      <span className={`flex-shrink-0 ${active ? "text-pi-primary" : "text-white/40"}`}>
        <Icon width={16} height={16} />
      </span>
      {!collapsed && <span className="flex-1">{label}</span>}
    </Link>
  );
}

function BrandGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

// ── Sidebar icons (single source of truth, matches Pointer Imoveis.html) ────
function IconDashboard(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function IconInbox(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
function IconLeads(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}
function IconCampaigns(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="m3 11 18-5v12l-18-5z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}
function IconAppointments(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconProperties(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M3 21V11l9-7 9 7v10" />
      <path d="M9 21V13h6v8" />
    </svg>
  );
}
function IconAgents(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  );
}
function IconPipelines(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <rect x="3" y="3" width="5" height="18" rx="1" />
      <rect x="10" y="3" width="5" height="12" rx="1" />
      <rect x="17" y="3" width="4" height="7" rx="1" />
    </svg>
  );
}
function IconInstances(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconTriggers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function IconSources(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  );
}
function IconUsers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}
function IconMetrics(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 5-5" />
    </svg>
  );
}
function IconFollowups(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function IconBrokerQueue(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function IconAlerts(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
