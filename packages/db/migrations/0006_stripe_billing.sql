CREATE TABLE `stripe_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_timestamp` integer NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stripe_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`price_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`event_timestamp` integer NOT NULL,
	`event_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `stripe_webhook_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stripe_subscriptions_user_idx` ON `stripe_subscriptions` (`user_id`);
--> statement-breakpoint
CREATE TABLE `stripe_customers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_customers_customer_unique` ON `stripe_customers` (`customer_id`);
--> statement-breakpoint
DROP TABLE `clerk_subscription_items`;
