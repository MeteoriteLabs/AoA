CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"title" text,
	"bio" text,
	"social_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
