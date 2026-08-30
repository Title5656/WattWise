PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_appliance_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`catalog_key` text NOT NULL,
	`category_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`model_code` text NOT NULL,
	`display_name` text NOT NULL,
	`calculation_method` text NOT NULL,
	`rated_power_w` real,
	`standby_power_w` real,
	`annual_energy_kwh` real,
	`energy_per_cycle_kwh` real,
	`load_factor` real,
	`usage_profile` text,
	`capacity_value` real,
	`capacity_unit` text,
	`efficiency_label` text,
	`source_url` text,
	`source_name` text,
	`verified_at` integer,
	`confidence` text DEFAULT 'sample' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `__new_household_appliances` (
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
	FOREIGN KEY (`appliance_model_id`) REFERENCES `__new_appliance_models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_appliance_models` (
	`id`, `catalog_key`, `category_id`, `brand_id`, `model_code`, `display_name`, `calculation_method`,
	`rated_power_w`, `standby_power_w`, `annual_energy_kwh`, `energy_per_cycle_kwh`, `capacity_value`,
	`capacity_unit`, `efficiency_label`, `source_url`, `source_name`, `verified_at`, `confidence`, `created_at`, `updated_at`
)
SELECT
	`id`, 'legacy-' || `id`, `category_id`, `brand_id`, `model_code`, `display_name`,
	CASE
		WHEN `energy_per_cycle_kwh` IS NOT NULL THEN 'per_cycle'
		WHEN `annual_energy_kwh` IS NOT NULL THEN 'annual_energy'
		ELSE 'rated_power'
	END,
	`rated_power_w`, `standby_power_w`, `annual_energy_kwh`, `energy_per_cycle_kwh`, `capacity_value`,
	`capacity_unit`, `efficiency_label`, `source_url`, `source_name`, `verified_at`, `confidence`, `created_at`, `updated_at`
FROM `appliance_models`;
--> statement-breakpoint
INSERT INTO `__new_household_appliances` (
	`id`, `household_id`, `appliance_model_id`, `custom_name`, `custom_power_w`, `room`, `quantity`,
	`hours_per_day`, `days_per_month`, `cycles_per_month`, `load_factor`, `start_minute`, `end_minute`, `created_at`, `updated_at`
)
SELECT
	`id`, `household_id`, `appliance_model_id`, `custom_name`, `custom_power_w`, `room`, `quantity`,
	`hours_per_day`, `days_per_month`, `cycles_per_month`, `load_factor`, `start_minute`, `end_minute`, `created_at`, `updated_at`
FROM `household_appliances`;
--> statement-breakpoint
DROP TABLE `household_appliances`;--> statement-breakpoint
DROP TABLE `appliance_models`;--> statement-breakpoint
ALTER TABLE `__new_appliance_models` RENAME TO `appliance_models`;--> statement-breakpoint
ALTER TABLE `__new_household_appliances` RENAME TO `household_appliances`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_appliance_models_catalog_key` ON `appliance_models` (`catalog_key`);--> statement-breakpoint
CREATE INDEX `idx_appliance_models_active_category_sort` ON `appliance_models` (`is_active`,`category_id`,`sort_order`,`catalog_key`);--> statement-breakpoint
CREATE INDEX `idx_appliance_models_active_search` ON `appliance_models` (`is_active`,`display_name`,`model_code`,`catalog_key`);--> statement-breakpoint
CREATE INDEX `idx_household_appliances_household` ON `household_appliances` (`household_id`);
