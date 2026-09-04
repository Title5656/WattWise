CREATE TABLE `household_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`invited_by_user_id` integer NOT NULL,
	`email_normalized` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_invites_role_check" CHECK("household_invites"."role" IN ('admin', 'member', 'viewer')),
	CONSTRAINT "household_invites_email_normalized_check" CHECK("household_invites"."email_normalized" = lower(trim("household_invites"."email_normalized")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_household_invites_token_hash` ON `household_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_household_invites_household_email` ON `household_invites` (`household_id`,`email_normalized`);--> statement-breakpoint
CREATE INDEX `idx_household_invites_email` ON `household_invites` (`email_normalized`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_household_invites_inviter` ON `household_invites` (`invited_by_user_id`);--> statement-breakpoint
CREATE TABLE `household_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_members_role_check" CHECK("household_members"."role" IN ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_household_members_household_user` ON `household_members` (`household_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_household_members_one_owner` ON `household_members` (`household_id`) WHERE "household_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX `idx_household_members_user` ON `household_members` (`user_id`,`household_id`);--> statement-breakpoint
CREATE INDEX `idx_household_members_household_role` ON `household_members` (`household_id`,`role`);--> statement-breakpoint
CREATE TABLE `household_monthly_energy_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`billing_month` text NOT NULL,
	`estimated_kwh` real,
	`estimated_bill` real,
	`actual_kwh` real,
	`actual_bill` real,
	`estimated_at` integer,
	`actual_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_household_monthly_energy_records_household_month` ON `household_monthly_energy_records` (`household_id`,`billing_month`);--> statement-breakpoint
CREATE TABLE `tariff_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_key` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tariff_products_product_key` ON `tariff_products` (`product_key`);--> statement-breakpoint
CREATE INDEX `idx_tariff_products_provider` ON `tariff_products` (`provider`);--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_identities_provider_subject` ON `user_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `idx_user_identities_user` ON `user_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_public_id` ON `users` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `household_appliances` ADD `instance_key` text;--> statement-breakpoint
ALTER TABLE `household_appliances` ADD `usage_schedule` text;--> statement-breakpoint
ALTER TABLE `household_appliances` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_household_appliances_household_instance` ON `household_appliances` (`household_id`,`instance_key`);--> statement-breakpoint
CREATE INDEX `idx_household_appliances_household_position` ON `household_appliances` (`household_id`,`position`);--> statement-breakpoint
ALTER TABLE `households` ADD `public_id` text;--> statement-breakpoint
ALTER TABLE `households` ADD `electricity_provider` text;--> statement-breakpoint
ALTER TABLE `households` ADD `tariff_product_id` integer REFERENCES `tariff_products`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `households` ADD `home_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'quarantined', 'deleted'));--> statement-breakpoint
CREATE UNIQUE INDEX `idx_households_public_id` ON `households` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_households_tariff_product` ON `households` (`tariff_product_id`);--> statement-breakpoint
ALTER TABLE `tariff_plans` ADD `product_id` integer REFERENCES tariff_products(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `idx_tariff_plans_product_effective` ON `tariff_plans` (`product_id`,`effective_from`);
