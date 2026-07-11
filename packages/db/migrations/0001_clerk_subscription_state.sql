CREATE TABLE `clerk_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_timestamp` integer NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clerk_subscription_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payer_user_id` text NOT NULL,
	`plan_slug` text NOT NULL,
	`status` text NOT NULL,
	`event_timestamp` integer NOT NULL,
	`event_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `clerk_webhook_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clerk_subscription_items_payer_idx` ON `clerk_subscription_items` (`payer_user_id`);
