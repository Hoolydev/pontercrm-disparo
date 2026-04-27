/**
 * Canonical list of LLM models available for agent configuration. Single
 * source of truth — UI dropdowns + LLM router (`@pointer/llm`) read from here.
 *
 * Grouped by provider with `family` for UI sectioning. Each entry's `id` must
 * match the model string the LLM provider expects.
 */
export type LLMModelOption = {
  id: string;
  label: string;
  provider: "openai" | "anthropic";
  family: string;
  /** Hint for the UI: lower-cost mini variants get a "mini" badge. */
  tier: "flagship" | "mini" | "nano" | "reasoning";
  /** Human-readable description of when to pick this model. */
  hint?: string;
};

export const LLM_MODELS: LLMModelOption[] = [
  // ── OpenAI: GPT-5 family (latest) ────────────────────────────────────
  {
    id: "gpt-5",
    label: "GPT-5",
    provider: "openai",
    family: "GPT-5",
    tier: "flagship",
    hint: "Top de linha OpenAI — qualidade máxima"
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    provider: "openai",
    family: "GPT-5",
    tier: "mini",
    hint: "Equilíbrio custo/qualidade — ótimo para qualificação inbound"
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    provider: "openai",
    family: "GPT-5",
    tier: "nano",
    hint: "Mais barato — ideal para outbound em massa"
  },

  // ── OpenAI: GPT-4.1 family ───────────────────────────────────────────
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    provider: "openai",
    family: "GPT-4.1",
    tier: "flagship",
    hint: "Geração anterior — ainda muito boa"
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openai",
    family: "GPT-4.1",
    tier: "mini",
    hint: "Equilíbrio custo/qualidade — recomendado para inbound"
  },
  {
    id: "gpt-4.1-nano",
    label: "GPT-4.1 Nano",
    provider: "openai",
    family: "GPT-4.1",
    tier: "nano",
    hint: "Mais barato — ideal para outbound com primeira mensagem template"
  },

  // ── OpenAI: GPT-4o ───────────────────────────────────────────────────
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    family: "GPT-4o",
    tier: "flagship",
    hint: "Multimodal — bom em vision (não usamos hoje)"
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    family: "GPT-4o",
    tier: "mini"
  },

  // ── OpenAI: o-series (reasoning) ─────────────────────────────────────
  {
    id: "o3-mini",
    label: "o3 Mini",
    provider: "openai",
    family: "o-series",
    tier: "reasoning",
    hint: "Reasoning — qualificação complexa, latência mais alta"
  },
  {
    id: "o4-mini",
    label: "o4 Mini",
    provider: "openai",
    family: "o-series",
    tier: "reasoning",
    hint: "Reasoning leve — preço melhor que o3"
  },

  // ── Anthropic: Claude 4.x ─────────────────────────────────────────────
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    family: "Claude 4.x",
    tier: "flagship",
    hint: "Top de linha Anthropic"
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    family: "Claude 4.x",
    tier: "flagship"
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    family: "Claude 4.x",
    tier: "mini",
    hint: "Rápido e barato — bom para outbound em massa"
  }
];

export const DEFAULT_AGENT_MODEL = "gpt-5-mini";

export function findModel(id: string): LLMModelOption | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}
