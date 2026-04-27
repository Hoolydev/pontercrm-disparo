import { verifyHmac } from "@pointer/shared";
import type { FastifyRequest } from "fastify";

export type LeadSourceAuth =
  | { mode: "hmac"; headerName?: string }
  | { mode: "api_key"; headerName?: string }
  | { mode: "none" };

/**
 * Verify the inbound webhook signature for a lead source.
 *
 * Modes:
 *   - hmac: header X-Signature (or custom) carries `sha256=<hex>` of body
 *   - api_key: header X-API-KEY (or custom) must equal the secret literally
 *     — used by OLX/ZAP Lead Manager
 *   - none: dev/testing only, accepts everything
 */
export function verifyLeadSourceAuth(
  req: FastifyRequest,
  rawBody: string,
  secret: string,
  auth: LeadSourceAuth = { mode: "hmac" }
): boolean {
  if (auth.mode === "none") return true;

  if (auth.mode === "api_key") {
    const headerName = (auth.headerName ?? "x-api-key").toLowerCase();
    const provided = (req.headers[headerName] as string | undefined)?.trim();
    if (!provided) return false;
    return constantTimeEquals(provided, secret);
  }

  // hmac (default)
  const headerName = auth.headerName ?? "x-signature";
  const sig = (req.headers[headerName] as string | undefined)?.replace(/^sha256=/, "");
  if (!sig) return false;
  try {
    return verifyHmac(secret, rawBody, sig);
  } catch {
    return false;
  }
}

/** Backwards-compat alias for the older signature. */
export function verifyHmacHeader(
  req: FastifyRequest,
  rawBody: string,
  secret: string,
  headerName = "x-signature"
): boolean {
  return verifyLeadSourceAuth(req, rawBody, secret, { mode: "hmac", headerName });
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
