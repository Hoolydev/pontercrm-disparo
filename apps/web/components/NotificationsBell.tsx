"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Notification = {
  id: string;
  kind: "handoff" | "followup" | "redistribute" | "sla" | "new_message" | "system";
  title: string;
  body: string | null;
  refId: string | null;
  refType: string | null;
  read: boolean;
  createdAt: string;
};

const KIND_ICON: Record<string, string> = {
  handoff: "🤝",
  followup: "⏰",
  redistribute: "🔄",
  sla: "🚨",
  new_message: "💬",
  system: "📌"
};

const KIND_COLOR: Record<string, string> = {
  handoff: "rgba(21,122,255,0.16)",
  followup: "rgba(245,158,11,0.16)",
  redistribute: "rgba(124,58,237,0.16)",
  sla: "rgba(239,68,68,0.16)",
  new_message: "rgba(49,186,150,0.16)",
  system: "rgba(120,120,140,0.16)"
};

export function NotificationsBell({ collapsed }: { collapsed: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api.get<{ notifications: Notification[]; unreadCount: number }>("/notifications?limit=20"),
    refetchInterval: 30_000
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] })
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/mark-all-read"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] })
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const unread = data?.unreadCount ?? 0;
  const items = data?.notifications ?? [];

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        title={collapsed ? "Notificações" : undefined}
        className={`flex items-center w-full rounded-xl text-[13px] transition-colors ${
          open
            ? "bg-[rgba(21,122,255,0.18)] text-pi-primary"
            : "text-white/65 bg-white/[0.04] hover:bg-white/[0.08]"
        }`}
        style={{
          padding: collapsed ? "10px 0" : "9px 12px",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: collapsed ? 0 : 10
        }}
      >
        <span className="relative inline-flex flex-shrink-0 text-white/40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-pi-danger border-2 border-pi-bg" />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Notificações</span>
            {unread > 0 && (
              <span className="rounded-full bg-pi-danger text-white text-[10px] font-bold px-1.5 py-px">
                {unread}
              </span>
            )}
          </>
        )}
      </button>

      {open && (
        <div
          className="fixed bottom-20 z-50 w-80 rounded-2xl bg-[#1e2030] border border-white/10 shadow-2xl overflow-hidden"
          style={{ left: collapsed ? 72 : 232 }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
            <span className="text-[13px] font-bold text-white">Notificações</span>
            <button
              onClick={() => markAll.mutate()}
              disabled={unread === 0}
              className="text-[11px] font-semibold text-pi-primary hover:underline disabled:opacity-40"
            >
              Marcar todas como lidas
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-center text-xs text-white/40 py-8">Nada por aqui.</p>
            ) : (
              items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notif={n}
                  onClick={() => {
                    if (!n.read) markOne.mutate(n.id);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notif,
  onClick
}: {
  notif: Notification;
  onClick: () => void;
}) {
  const time = relativeTime(notif.createdAt);
  const targetHref =
    notif.refType === "conversation" && notif.refId ? `/app/inbox/${notif.refId}` : undefined;

  const inner = (
    <div className="flex gap-2.5 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.04]">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] flex-shrink-0"
        style={{ background: KIND_COLOR[notif.kind] ?? "rgba(120,120,140,0.16)" }}
      >
        {KIND_ICON[notif.kind] ?? "📌"}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs ${notif.read ? "font-normal" : "font-bold"} text-white m-0`}>
          {notif.title}
        </p>
        {notif.body && (
          <p className="text-[11px] text-white/45 m-0 mt-0.5 truncate">{notif.body}</p>
        )}
        <p className="text-[10px] text-white/30 mt-0.5">{time}</p>
      </div>
      {!notif.read && (
        <span className="w-1.5 h-1.5 rounded-full bg-pi-primary flex-shrink-0 mt-1.5" />
      )}
    </div>
  );

  if (targetHref) {
    return (
      <Link
        href={targetHref}
        onClick={onClick}
        className={`block border-b border-white/[0.05] ${
          notif.read ? "" : "bg-[rgba(21,122,255,0.08)]"
        }`}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div
      onClick={onClick}
      className={`border-b border-white/[0.05] ${notif.read ? "" : "bg-[rgba(21,122,255,0.08)]"}`}
    >
      {inner}
    </div>
  );
}

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}
