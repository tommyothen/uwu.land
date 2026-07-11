CREATE INDEX `links_owner_created_slug_idx` ON `links` (`owner_id`,`created_at`,`slug`);
--> statement-breakpoint
CREATE INDEX `links_owner_external_ref_created_slug_idx` ON `links` (`owner_id`,`external_ref`,`created_at`,`slug`);
