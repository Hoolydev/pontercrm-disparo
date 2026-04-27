ALTER TABLE "agents" ADD COLUMN "first_message" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "handoff_agent_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "flow_json" jsonb;
