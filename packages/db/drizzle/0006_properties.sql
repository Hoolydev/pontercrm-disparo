CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'apartment' NOT NULL,
	"transaction_type" text DEFAULT 'sale' NOT NULL,
	"price_cents" integer,
	"condo_fee_cents" integer,
	"iptu_cents" integer,
	"bedrooms" integer,
	"bathrooms" integer,
	"parking_spots" integer,
	"area_sqm" integer,
	"features_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"address_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photos_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_code_uq" ON "properties" USING btree ("code") WHERE "properties"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "properties_active_idx" ON "properties" USING btree ("active");--> statement-breakpoint
CREATE INDEX "properties_transaction_idx" ON "properties" USING btree ("transaction_type");