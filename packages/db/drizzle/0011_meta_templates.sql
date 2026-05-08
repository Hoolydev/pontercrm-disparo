-- Meta Cloud API native message template support for outbound first-touch.
-- Stores the Meta-approved template name + language to send on the very first
-- message of a campaign-seeded conversation, plus a parameter mapping that
-- describes how to fill the {{1}}, {{2}}, ... slots from lead/campaign fields.
--
-- IF NOT EXISTS on every ADD COLUMN: drizzle splits statements on
-- `--> statement-breakpoint` and runs them outside a single transaction, so
-- a failure mid-migration leaves earlier columns applied. Idempotency lets
-- the migration self-heal on retry.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "meta_template_name" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "meta_template_language" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "meta_template_param_map" jsonb;--> statement-breakpoint
-- Per-message payload that the outbound worker uses to fire `type: "template"`
-- against the Graph API (vs the default `type: "text"`). Null = plain text.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "meta_template_payload_json" jsonb;
