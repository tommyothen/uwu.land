ALTER TABLE `links` ADD `lifecycle_state` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `links` ADD `url_hash` text;
--> statement-breakpoint
ALTER TABLE `links` ADD `reconcile_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `links` ADD `last_reconcile_at` integer;
--> statement-breakpoint
ALTER TABLE `links` ADD `last_reconcile_error` text;
--> statement-breakpoint
CREATE INDEX `links_lifecycle_idx` ON `links` (`lifecycle_state`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_url_hash_unique` ON `links` (`url_hash`);
