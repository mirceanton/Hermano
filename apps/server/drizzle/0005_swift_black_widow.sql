ALTER TABLE `hermes_profiles` ADD `use_shared_connection` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Make url nullable: when use_shared_connection=1, the profile inherits its
-- url from the global Hermes Agent setting (env var or Settings page). The
-- column-level NOT NULL is replaced by an application-level check, because
-- SQLite doesn't support DROP NOT NULL via ALTER COLUMN — we recreate the
-- table below with the relaxed constraint.
CREATE TABLE `__new_hermes_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`api_key` text,
	`use_shared_connection` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_hermes_profiles` (`id`, `name`, `url`, `api_key`, `use_shared_connection`, `created_at`, `updated_at`)
	SELECT `id`, `name`, `url`, `api_key`, 0, `created_at`, `updated_at` FROM `hermes_profiles`;--> statement-breakpoint
DROP TABLE `hermes_profiles`;--> statement-breakpoint
ALTER TABLE `__new_hermes_profiles` RENAME TO `hermes_profiles`;--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_profiles_name_unique` ON `hermes_profiles` (`name`);
