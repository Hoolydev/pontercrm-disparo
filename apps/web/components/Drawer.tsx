"use client";
import { useEffect, type ReactNode } from "react";

/**
 * Reusable lateral drawer (matches Pointer Imoveis.html spec).
 * - Backdrop click + Esc closes
 * - body scroll lock while open
 * - 480px default width, configurable
 * - Header with title + close button, scrollable body
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 480,
  footer
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        onClick={onClose}
        className="flex-1 bg-black/55 backdrop-blur-[2px] cursor-pointer"
      />
      <div
        className="bg-white h-full overflow-y-auto shadow-[-8px_0_40px_rgba(0,0,0,0.15)] flex flex-col"
        style={{ width }}
      >
        <div className="flex items-center justify-between border-b border-[#f0f2f5] px-7 py-5 flex-shrink-0">
          <h3 className="text-base font-bold text-[#273240] m-0">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e8ecf2] bg-white text-neutral-500 text-lg leading-none hover:bg-neutral-50"
            title="Fechar (Esc)"
          >
            ×
          </button>
        </div>
        <div className="flex-1 px-7 py-6">{children}</div>
        {footer && (
          <div className="border-t border-[#f0f2f5] px-7 py-4 flex-shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function DrawerTabs({
  tabs,
  active,
  onChange
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="border-b border-[#f0f2f5] -mx-7 px-7 mb-6 flex gap-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`pb-3 -mb-px text-sm font-medium transition-colors border-b-2 ${
            active === t.id
              ? "text-pi-primary border-pi-primary"
              : "text-neutral-500 border-transparent hover:text-neutral-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
