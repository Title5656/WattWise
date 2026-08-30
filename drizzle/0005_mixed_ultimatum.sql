PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
DROP TABLE `appliance_models`;--> statement-breakpoint
ALTER TABLE `__new_appliance_models` RENAME TO `appliance_models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_appliance_models_catalog_key` ON `appliance_models` (`catalog_key`);--> statement-breakpoint
CREATE INDEX `idx_appliance_models_active_category_sort` ON `appliance_models` (`is_active`,`category_id`,`sort_order`,`catalog_key`);--> statement-breakpoint
CREATE INDEX `idx_appliance_models_active_search` ON `appliance_models` (`is_active`,`display_name`,`model_code`,`catalog_key`);
