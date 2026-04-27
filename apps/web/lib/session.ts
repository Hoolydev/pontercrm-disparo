"use client";
import type { Role } from "@pointer/shared";

const KEY = "pointer_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setToken(token: string) {
  localStorage.setItem(KEY, token);
}

export function clearToken() {
  localStorage.removeItem(KEY);
}

export type Session = { token: string; role: Role; userId: string };

export function getSession(): Session | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!));
    return { token, role: payload.role as Role, userId: payload.sub as string };
  } catch {
    return null;
  }
}
