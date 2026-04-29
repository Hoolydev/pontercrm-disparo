import { getToken } from "./session";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

type RequestInit2 = RequestInit & { params?: Record<string, string> };

async function apiFetch<T>(path: string, init: RequestInit2 = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  const url = `${BASE}${path}`;
  const res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    // Clear stale token and redirect to login
    if (typeof window !== "undefined") {
      localStorage.removeItem("pointer_token");
      window.location.href = "/login";
    }
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res.text() as unknown as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body != null ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body != null ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body != null ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" })
};

// Typed helpers
export type StageSummary = {
  id: string;
  name: string;
  category: "open" | "won" | "lost";
  color: string | null;
};

export type CampaignSummary = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  pipelineId?: string;
};

export type ConversationSummary = {
  id: string;
  status: string;
  aiPaused: boolean;
  lastMessageAt: string | null;
  lead: {
    id: string;
    name: string | null;
    phone: string;
    pipelineStageId?: string | null;
    pipelineStage?: StageSummary | null;
  };
  assignedBroker: { id: string; displayName: string } | null;
  campaign: CampaignSummary | null;
  messages: {
    id: string;
    content: string;
    senderType: string;
    createdAt: string;
    status: string;
  }[];
};

export type Message = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  senderType: string;
  content: string;
  status: string;
  createdAt: string;
};

export type ConversationDetail = Omit<ConversationSummary, "messages" | "lead"> & {
  lead: ConversationSummary["lead"] & {
    email: string | null;
    origin: string | null;
    propertyRef: string | null;
  };
  agent?: { id: string; name: string; model: string; type: "inbound" | "outbound" } | null;
  messages: Message[];
};
