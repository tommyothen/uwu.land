CREATE TABLE `account_tombstones` (
	`event_id` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_tombstones_email_idx` ON `account_tombstones` (`email_hash`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `limited_until` integer;