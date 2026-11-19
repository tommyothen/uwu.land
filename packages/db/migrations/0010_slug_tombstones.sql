CREATE TABLE `slug_tombstones` (
	`slug` text PRIMARY KEY NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
-- Deletes still awaiting reconciliation predate the tombstone write.
INSERT INTO `slug_tombstones` (`slug`, `deleted_at`)
SELECT `slug`, unixepoch() FROM `links` WHERE `lifecycle_state` = 'pending_delete';
--> statement-breakpoint
-- Backstop for every links insert path, including the anonymous generator,
-- which only checks KV. The message mimics a unique violation so callers treat
-- a tombstoned slug exactly like a taken one (retry or 409).
CREATE TRIGGER `links_reject_tombstoned_slug` BEFORE INSERT ON `links`
WHEN EXISTS (SELECT 1 FROM `slug_tombstones` WHERE `slug` = NEW.`slug`)
BEGIN
	SELECT RAISE(ABORT, 'UNIQUE constraint failed: slug_tombstones.slug');
END;
