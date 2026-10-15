CREATE TYPE "public"."broadcast_status" AS ENUM('running', 'done', 'interrupted');--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"status" "broadcast_status" DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_one_running" ON "broadcasts" USING btree ("status") WHERE "broadcasts"."status" = 'running';