CREATE TABLE `stripe_lifetime_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_intent_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`price_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`event_timestamp` integer NOT NULL,
	`event_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `stripe_webhook_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stripe_lifetime_purchases_user_idx` ON `stripe_lifetime_purchases` (`user_id`);
