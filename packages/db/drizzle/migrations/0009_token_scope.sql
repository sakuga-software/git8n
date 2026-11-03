CREATE TYPE "public"."token_scope" AS ENUM('read', 'propose', 'full');--> statement-breakpoint
-- A token made before G8N-114 keeps every right of its account. The default fills the rows that exist, then goes.
ALTER TABLE "access_tokens" ADD COLUMN "scope" "token_scope" DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "access_tokens" ALTER COLUMN "scope" DROP DEFAULT;
