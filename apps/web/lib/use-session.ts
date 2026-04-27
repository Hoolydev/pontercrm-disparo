"use client";
import { useEffect, useState } from "react";
import { type Session, getSession } from "./session";

export function useSession() {
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    setSession(getSession());
  }, []);

  return session;
}
