CREATE TABLE `hermes_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`api_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_profiles_name_unique` ON `hermes_profiles` (`name`);--> statement-breakpoint
ALTER TABLE `delegation_rules` ADD `profile_id` integer REFERENCES hermes_profiles(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `delegations` ADD `profile_id` integer REFERENCES hermes_profiles(id) ON DELETE set null;