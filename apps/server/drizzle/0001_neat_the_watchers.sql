CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hermes_agent_url` text,
	`hermes_agent_api_key` text,
	`hermes_dispatch_timeout_ms` integer,
	`hermes_poll_interval_ms` integer,
	`custom_system_prompt` text,
	`oidc_issuer_url` text,
	`oidc_client_id` text,
	`oidc_client_secret` text,
	`oidc_redirect_url` text,
	`session_secret` text,
	`updated_at` integer NOT NULL
);
