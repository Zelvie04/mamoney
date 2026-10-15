CREATE TYPE "public"."report_status" AS ENUM('sent', 'blocked', 'failed');--> statement-breakpoint
CREATE TABLE "report_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"kind" "budget_period" NOT NULL,
	"status" "report_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned" ADD COLUMN "type" "category_type" DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_log" ADD CONSTRAINT "report_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_log_created_idx" ON "report_log" USING btree ("created_at");