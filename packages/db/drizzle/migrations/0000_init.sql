CREATE TYPE "public"."i18n_role" AS ENUM('translator', 'reviewer');--> statement-breakpoint
CREATE TABLE "i18n_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"locales_path" text NOT NULL,
	"languages" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "i18n_translators" (
	"user_id" text PRIMARY KEY NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"role" "i18n_role" DEFAULT 'translator' NOT NULL,
	"writes_source" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "i18n_repositories_owner_name_idx" ON "i18n_repositories" USING btree ("owner","name");