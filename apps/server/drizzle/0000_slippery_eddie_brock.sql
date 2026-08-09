CREATE TABLE `alert_triggers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` integer NOT NULL,
	`fired_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_triggers_alert_id_idx` ON `alert_triggers` (`alert_id`);--> statement-breakpoint
CREATE INDEX `alert_triggers_fired_at_idx` ON `alert_triggers` (`fired_at`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`alert_name` text NOT NULL,
	`severity` text DEFAULT '' NOT NULL,
	`labels` text DEFAULT '{}' NOT NULL,
	`annotations` text DEFAULT '{}' NOT NULL,
	`generator_url` text DEFAULT '' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alerts_alert_name_idx` ON `alerts` (`alert_name`);--> statement-breakpoint
CREATE INDEX `alerts_resolved_at_idx` ON `alerts` (`resolved_at`);--> statement-breakpoint
CREATE INDEX `alerts_fingerprint_idx` ON `alerts` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_fingerprint_active_unique` ON `alerts` (`fingerprint`) WHERE "alerts"."resolved_at" is null;--> statement-breakpoint
CREATE TABLE `delegation_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`matchers` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `delegations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` integer NOT NULL,
	`trigger_id` integer,
	`rule_id` integer,
	`rule_snapshot` text NOT NULL,
	`status` text NOT NULL,
	`run_id` text,
	`delegated_at` integer NOT NULL,
	`dispatched_at` integer,
	`completed_at` integer,
	`summary` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_id`) REFERENCES `alert_triggers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rule_id`) REFERENCES `delegation_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `delegations_alert_id_idx` ON `delegations` (`alert_id`);--> statement-breakpoint
CREATE INDEX `delegations_status_idx` ON `delegations` (`status`);--> statement-breakpoint
CREATE INDEX `delegations_run_id_idx` ON `delegations` (`run_id`);--> statement-breakpoint
CREATE INDEX `delegations_delegated_at_idx` ON `delegations` (`delegated_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`oidc_subject` text,
	`email` text,
	`name` text,
	`is_local_owner` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_subject_unique` ON `users` (`oidc_subject`);