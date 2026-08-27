CREATE TABLE `monthly_energy_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_key` text NOT NULL,
	`billing_month` text NOT NULL,
	`estimated_kwh` real,
	`estimated_bill` real,
	`actual_kwh` real,
	`actual_bill` real,
	`estimated_at` integer,
	`actual_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_monthly_energy_records_household_month` ON `monthly_energy_records` (`household_key`,`billing_month`);
