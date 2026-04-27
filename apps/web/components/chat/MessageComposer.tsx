"use client";
import { useState } from "react";
import { api } from "../../lib/api";

export default function MessageComposer({
  conversationId,
  disabled,
  onSent
}: {
  conversationId: string;
  disabled: boolean;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await api.post(`/conversations/${conversationId}/messages`, { text: msg });
      setText("");
      onSent();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-neutral-200 bg-white px-4 py-3">
      {disabled && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Assuma a conversa para enviar mensagens manualmente.
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || sending}
          placeholder={disabled ? "IA está respondendo…" : "Escreva uma mensagem…"}
          className="flex-1 resize-none rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-neutral-50 disabled:text-neutral-400"
        />
        <button
          onClick={send}
          disabled={disabled || sending || !text.trim()}
          className="flex-shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>
      <p className="mt-1 text-right text-[10px] text-neutral-300">Enter para enviar · Shift+Enter para nova linha</p>
    </div>
  );
}
