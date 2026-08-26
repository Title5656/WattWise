CREATE TABLE `saved_home_appliances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_key` text NOT NULL,
	`appliance_key` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`hours_per_day` real DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_saved_home_appliances_household` ON `saved_home_appliances` (`household_key`,`position`);