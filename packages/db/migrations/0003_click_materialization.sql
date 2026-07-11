ALTER TABLE `links` ADD `clicks` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `click_materialization_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` text,
	`updated_at` integer NOT NULL
);
