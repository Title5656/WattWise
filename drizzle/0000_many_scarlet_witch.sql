CREATE TABLE `appliance_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`model_code` text NOT NULL,
	`display_name` text NOT NULL,
	`rated_power_w` real,
	`standby_power_w` real,
	`annual_energy_kwh` real,
	`energy_per_cycle_kwh` real,
	`capacity_value` real,
	`capacity_unit` text,
	`efficiency_label` text,
	`source_url` text,
	`source_name` text,
	`verified_at` integer,
	`confidence` text DEFAULT 'sample' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_appliance_models_brand_model` ON `appliance_models` (`brand_id`,`model_code`);--> statement-breakpoint
CREATE INDEX `idx_appliance_models_category` ON `appliance_models` (`category_id`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`country_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_brands_name` ON `brands` (`name`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name_th` text NOT NULL,
	`name_en` text NOT NULL,
	`calculation_method` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_slug` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `household_appliances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`appliance_model_id` integer,
	`custom_name` text,
	`custom_power_w` real,
	`room` text DEFAULT 'ไม่ระบุ' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`hours_per_day` real,
	`days_per_month` integer DEFAULT 30 NOT NULL,
	`cycles_per_month` real,
	`load_factor` real,
	`start_minute` integer,
	`end_minute` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appliance_model_id`) REFERENCES `appliance_models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_household_appliances_household` ON `household_appliances` (`household_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`province` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tariff_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`service_charge` real DEFAULT 0 NOT NULL,
	`ft_rate_per_kwh` real DEFAULT 0 NOT NULL,
	`vat_rate` real DEFAULT 0.07 NOT NULL,
	`source_url` text
);
--> statement-breakpoint
CREATE INDEX `idx_tariff_plans_effective` ON `tariff_plans` (`effective_from`);--> statement-breakpoint
CREATE TABLE `tariff_tiers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tariff_plan_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`from_kwh` real NOT NULL,
	`to_kwh` real,
	`rate_per_kwh` real NOT NULL,
	FOREIGN KEY (`tariff_plan_id`) REFERENCES `tariff_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tariff_tiers_plan_sequence` ON `tariff_tiers` (`tariff_plan_id`,`sequence`);