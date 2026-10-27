CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_languages" (
	"member_id" text NOT NULL,
	"language" text NOT NULL,
	CONSTRAINT "member_languages_member_id_language_pk" PRIMARY KEY("member_id","language")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"writes_source" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "i18n_repositories" ADD COLUMN "organization_id" text;--> statement-breakpoint
INSERT INTO "organizations" ("id", "name", "slug") SELECT "id", "owner" || '/' || "name", "id" FROM "i18n_repositories";--> statement-breakpoint
UPDATE "i18n_repositories" SET "organization_id" = "id";--> statement-breakpoint
ALTER TABLE "i18n_repositories" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
INSERT INTO "members" ("id", "organization_id", "user_id", "role", "writes_source", "created_at")
SELECT md5("t"."user_id" || ':' || "r"."id"), "r"."id", "t"."user_id", "t"."role"::text, "t"."writes_source", "t"."created_at"
FROM "i18n_translators" "t" CROSS JOIN "i18n_repositories" "r";--> statement-breakpoint
INSERT INTO "member_languages" ("member_id", "language")
SELECT DISTINCT md5("t"."user_id" || ':' || "r"."id"), "l"."language"
FROM "i18n_translators" "t" CROSS JOIN "i18n_repositories" "r" CROSS JOIN unnest("t"."languages") AS "l"("language")
WHERE "l"."language" = ANY("r"."languages"[2:]);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_languages" ADD CONSTRAINT "member_languages_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_user_idx" ON "members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "i18n_repositories" ADD CONSTRAINT "i18n_repositories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "i18n_repositories" ADD CONSTRAINT "i18n_repositories_organization_id_unique" UNIQUE("organization_id");