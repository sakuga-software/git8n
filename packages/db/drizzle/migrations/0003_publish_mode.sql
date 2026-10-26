CREATE TYPE "public"."publish_mode" AS ENUM('commit', 'pull_request');--> statement-breakpoint
ALTER TABLE "i18n_repositories" ADD COLUMN "publish_mode" "publish_mode" DEFAULT 'commit' NOT NULL;