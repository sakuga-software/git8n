CREATE TABLE "pending_member_languages" (
	"pending_member_id" text NOT NULL,
	"language" text NOT NULL,
	CONSTRAINT "pending_member_languages_pending_member_id_language_pk" PRIMARY KEY("pending_member_id","language")
);
--> statement-breakpoint
CREATE TABLE "pending_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text,
	"github_id" text,
	"github_login" text,
	"role" text NOT NULL,
	"writes_source" boolean DEFAULT false NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_members_names_somebody" CHECK ("pending_members"."email" is not null or "pending_members"."github_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "pending_member_languages" ADD CONSTRAINT "pending_member_languages_pending_member_id_pending_members_id_fk" FOREIGN KEY ("pending_member_id") REFERENCES "public"."pending_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_members" ADD CONSTRAINT "pending_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_members" ADD CONSTRAINT "pending_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_members_organization_email_idx" ON "pending_members" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_members_organization_github_idx" ON "pending_members" USING btree ("organization_id","github_id");--> statement-breakpoint
CREATE INDEX "pending_members_email_idx" ON "pending_members" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pending_members_github_id_idx" ON "pending_members" USING btree ("github_id");