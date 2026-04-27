-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Phase A — Campaigns + Agents + Pipelines + Tools (data-preserving)   ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Strategy:
--   1. Create new tables (agents, pipelines, pipeline_stages, campaigns, …)
--   2. Copy ai_configs rows into agents (same IDs preserved → conversations
--      and handoff_triggers can be migrated with a direct ai_config_id copy)
--   3. Backfill pipeline_stages from leads.status enum
--   4. Drop old columns / indexes / table only AFTER all FKs are migrated.

-- ── 1. New core tables ───────────────────────────────────────────────────
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text NOT NULL,
	"behavior_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"category" text NOT NULL,
	"color" text,
	"sla_hours" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ── 2. Migrate ai_configs → agents (data-preserving) ─────────────────────
INSERT INTO "agents" ("id", "name", "type", "model", "system_prompt", "behavior_json", "active", "created_at", "updated_at")
SELECT "id", "name", 'inbound', "model", "system_prompt", "behavior_json", "active", "created_at", "updated_at"
FROM "ai_configs";--> statement-breakpoint

-- ── 3. Default pipeline + 5 stages (legacy enum mapping) ─────────────────
INSERT INTO "pipelines" ("name", "description", "is_default", "active")
VALUES ('Padrão', 'Pipeline padrão — migrado do enum legado de leads.status', true, true);
--> statement-breakpoint
INSERT INTO "pipeline_stages" ("pipeline_id", "name", "position", "category", "color")
SELECT p."id", v."name", v."pos", v."cat", v."color"
FROM "pipelines" p,
     (VALUES
        ('Novo',         1, 'open', '#94a3b8'),
        ('Em conversa',  2, 'open', '#3b82f6'),
        ('Qualificado',  3, 'open', '#8b5cf6'),
        ('Ganho',        4, 'won',  '#22c55e'),
        ('Perdido',      5, 'lost', '#ef4444')
     ) AS v("name", "pos", "cat", "color")
WHERE p."is_default" = true;--> statement-breakpoint

-- ── 4. leads.status → leads.pipeline_stage_id ────────────────────────────
ALTER TABLE "leads" ADD COLUMN "pipeline_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "leads"
SET "pipeline_stage_id" = (
  SELECT ps."id" FROM "pipeline_stages" ps
  JOIN "pipelines" p ON p."id" = ps."pipeline_id" AND p."is_default" = true
  WHERE ps."name" = CASE "leads"."status"
    WHEN 'new'        THEN 'Novo'
    WHEN 'contacted'  THEN 'Em conversa'
    WHEN 'qualified'  THEN 'Qualificado'
    WHEN 'won'        THEN 'Ganho'
    WHEN 'lost'       THEN 'Perdido'
    ELSE 'Novo'
  END
);--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "pipeline_stage_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("pipeline_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "leads_status_idx";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "status";--> statement-breakpoint

-- ── 5. New campaign / appointment / tool tables ──────────────────────────
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"outbound_agent_id" uuid,
	"inbound_agent_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_instances" (
	"campaign_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_instances_campaign_id_instance_id_pk" PRIMARY KEY("campaign_id","instance_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"broker_id" uuid,
	"scheduled_for" timestamp with time zone NOT NULL,
	"address" text,
	"notes" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"source" text DEFAULT 'ai_tool' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"arguments_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_json" jsonb,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ── 6. FKs for new tables ────────────────────────────────────────────────
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_outbound_agent_id_agents_id_fk" FOREIGN KEY ("outbound_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_inbound_agent_id_agents_id_fk" FOREIGN KEY ("inbound_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_instances" ADD CONSTRAINT "campaign_instances_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_instances" ADD CONSTRAINT "campaign_instances_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ── 7. Migrate conversations: ai_config_id → agent_id; add campaign_id, mode
ALTER TABLE "conversations" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
UPDATE "conversations" SET "agent_id" = "ai_config_id";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_ai_config_id_ai_configs_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "ai_config_id";--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ── 8. Migrate handoff_triggers: ai_config_id → agent_id ─────────────────
ALTER TABLE "handoff_triggers" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
UPDATE "handoff_triggers" SET "agent_id" = "ai_config_id";--> statement-breakpoint
ALTER TABLE "handoff_triggers" DROP CONSTRAINT "handoff_triggers_ai_config_id_ai_configs_id_fk";--> statement-breakpoint
ALTER TABLE "handoff_triggers" DROP COLUMN "ai_config_id";--> statement-breakpoint
DROP INDEX IF EXISTS "handoff_triggers_ai_config_priority_idx";--> statement-breakpoint
ALTER TABLE "handoff_triggers" ADD CONSTRAINT "handoff_triggers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ── 9. messages: add media_type, tool_calls ──────────────────────────────
ALTER TABLE "messages" ADD COLUMN "media_type" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint

-- ── 10. outbound_dispatch_log: add campaign_id ───────────────────────────
ALTER TABLE "outbound_dispatch_log" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_dispatch_log" ADD CONSTRAINT "outbound_dispatch_log_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ── 11. Drop legacy table (now safe — no remaining FKs) ─────────────────
DROP TABLE "ai_configs";--> statement-breakpoint

-- ── 12. Indexes ──────────────────────────────────────────────────────────
CREATE INDEX "agents_type_active_idx" ON "agents" USING btree ("type","active");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_default_uq" ON "pipelines" USING btree ("is_default") WHERE "pipelines"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_pipeline_position_uq" ON "pipeline_stages" USING btree ("pipeline_id","position");--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_idx" ON "pipeline_stages" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "pipeline_stages_category_idx" ON "pipeline_stages" USING btree ("category");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("pipeline_stage_id");--> statement-breakpoint
CREATE INDEX "campaigns_active_idx" ON "campaigns" USING btree ("status") WHERE "campaigns"."status" = 'active';--> statement-breakpoint
CREATE INDEX "campaigns_pipeline_idx" ON "campaigns" USING btree ("pipeline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_leads_campaign_lead_uq" ON "campaign_leads" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_campaign_state_idx" ON "campaign_leads" USING btree ("campaign_id","state");--> statement-breakpoint
CREATE INDEX "appointments_broker_schedule_idx" ON "appointments" USING btree ("broker_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "appointments_upcoming_idx" ON "appointments" USING btree ("scheduled_for") WHERE "appointments"."status" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "tool_executions_message_tool_uq" ON "tool_executions" USING btree ("message_id","tool_name");--> statement-breakpoint
CREATE INDEX "conversations_campaign_status_idx" ON "conversations" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "handoff_triggers_agent_priority_idx" ON "handoff_triggers" USING btree ("agent_id","priority");--> statement-breakpoint
CREATE INDEX "outbound_dispatch_log_campaign_idx" ON "outbound_dispatch_log" USING btree ("campaign_id");
