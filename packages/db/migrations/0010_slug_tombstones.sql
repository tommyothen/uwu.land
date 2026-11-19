CREATE TABLE `slug_tombstones` (
	`slug` text PRIMARY KEY NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
-- Every removal of a links row leaves a tombstone, whatever marked it for
-- deletion: a user delete, a ban sweep, a purge script, the reconciler's
-- banned-before-publish branch, or an older Worker still running between this
-- migration and the deploy. One trigger means no delete path can forget.
CREATE TRIGGER `links_tombstone_on_delete` AFTER DELETE ON `links`
BEGIN
	INSERT OR IGNORE INTO `slug_tombstones` (`slug`, `deleted_at`) VALUES (OLD.`slug`, unixepoch());
END;
--> statement-breakpoint
-- Backstop for every links insert path, including the anonymous generator,
-- which only checks KV. The message mimics a unique violation so callers treat
-- a tombstoned slug exactly like a taken one (retry or 409).
CREATE TRIGGER `links_reject_tombstoned_slug` BEFORE INSERT ON `links`
WHEN EXISTS (SELECT 1 FROM `slug_tombstones` WHERE `slug` = NEW.`slug`)
BEGIN
	SELECT RAISE(ABORT, 'UNIQUE constraint failed: slug_tombstones.slug');
END;
