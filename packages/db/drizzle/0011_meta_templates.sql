-- Meta Cloud API native message template support for outbound first-touch.
-- Stores the Meta-approved template name + language to send on the very first
-- message of a campaign-seeded conversation, plus a parameter mapping that
-- describes how to fill the {{1}}, {{2}}, ... slots from lead/campaign fields.
ALTER TABLE "campaigns" ADD COLUMN "meta_template_name" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "meta_template_language" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "meta_template_param_map" jsonb;--> statement-breakpoint
-- Per-message payload that the outbound worker uses to fire `type: "template"`
-- against the Graph API (vs the default `type: "text"`). Null = plain text.
ALTER TABLE "messages" ADD COLUMN "meta_template_payload_json" jsonb;
