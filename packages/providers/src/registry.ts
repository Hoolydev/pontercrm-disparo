import type { WhatsappProvider } from "@pointer/shared";
import { EvolutionProvider } from "./evolution.js";
import { MetaCloudProvider } from "./meta-cloud.js";
import type { WhatsAppProvider } from "./types.js";
import { UazapiProvider } from "./uazapi.js";

const REGISTRY: Partial<Record<WhatsappProvider, WhatsAppProvider>> = {
  uazapi: new UazapiProvider(),
  meta: new MetaCloudProvider(),
  evolution: new EvolutionProvider()
};

export function getProvider(kind: WhatsappProvider): WhatsAppProvider {
  const p = REGISTRY[kind];
  if (!p) throw new Error(`WhatsApp provider not implemented: ${kind}`);
  return p;
}
