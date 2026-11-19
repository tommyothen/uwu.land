ALTER TABLE `links` ADD `deleted_owner_hash` text;--> statement-breakpoint
CREATE INDEX `links_deleted_owner_hash_idx` ON `links` (`deleted_owner_hash`);--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_at` integer;