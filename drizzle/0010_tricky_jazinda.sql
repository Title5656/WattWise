CREATE TABLE `legacy_cutover_issue_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`code` text NOT NULL,
	`source_table` text NOT NULL,
	`source_row_id` text,
	`details` text NOT NULL,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `legacy_cutover_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legacy_cutover_issue_events_identity` ON `legacy_cutover_issue_events` (`source_id`,`code`,`source_table`,`source_row_id`,`details`);--> statement-breakpoint
CREATE INDEX `idx_legacy_cutover_issue_events_source` ON `legacy_cutover_issue_events` (`source_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `legacy_cutover_manifest_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`item_kind` text NOT NULL,
	`source_table` text NOT NULL,
	`source_row_id` text NOT NULL,
	`payload` text NOT NULL,
	`payload_checksum` text NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `legacy_cutover_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "legacy_cutover_manifest_kind_check" CHECK("legacy_cutover_manifest_rows"."item_kind" IN ('config', 'appliance', 'monthly'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legacy_cutover_manifest_source_row` ON `legacy_cutover_manifest_rows` (`source_id`,`item_kind`,`source_table`,`source_row_id`);--> statement-breakpoint
CREATE INDEX `idx_legacy_cutover_manifest_source` ON `legacy_cutover_manifest_rows` (`source_id`,`item_kind`);--> statement-breakpoint
ALTER TABLE `household_claim_tokens` ADD `verification_epoch` integer;--> statement-breakpoint
ALTER TABLE `household_claim_tokens` ADD `target_checksum` text;--> statement-breakpoint
ALTER TABLE `legacy_cutover_sources` ADD `manifest_row_count` integer;--> statement-breakpoint
ALTER TABLE `legacy_cutover_sources` ADD `manifest_checksum` text;--> statement-breakpoint
ALTER TABLE `legacy_cutover_sources` ADD `verification_checksum` text;--> statement-breakpoint
ALTER TABLE `legacy_cutover_sources` ADD `source_drift` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `legacy_cutover_sources` ADD `verification_epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `legacy_cutover_sources` ADD `sealed_at` integer;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_manifest_rows_no_update`
BEFORE UPDATE ON `legacy_cutover_manifest_rows`
WHEN EXISTS (SELECT 1 FROM `legacy_cutover_sources`
	WHERE `id` = OLD.`source_id` AND `manifest_checksum` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'legacy cutover manifest is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_manifest_rows_no_delete`
BEFORE DELETE ON `legacy_cutover_manifest_rows`
WHEN EXISTS (SELECT 1 FROM `legacy_cutover_sources`
	WHERE `id` = OLD.`source_id` AND `manifest_checksum` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'legacy cutover manifest is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_manifest_rows_no_insert_after_seal`
BEFORE INSERT ON `legacy_cutover_manifest_rows`
WHEN EXISTS (SELECT 1 FROM `legacy_cutover_sources`
	WHERE `id` = NEW.`source_id` AND `manifest_checksum` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'legacy cutover manifest is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_issue_events_no_update`
BEFORE UPDATE ON `legacy_cutover_issue_events`
BEGIN SELECT RAISE(ABORT, 'legacy cutover issue history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_issue_events_no_delete`
BEFORE DELETE ON `legacy_cutover_issue_events`
BEGIN SELECT RAISE(ABORT, 'legacy cutover issue history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_baseline_no_update`
BEFORE UPDATE OF `source_appliance_count`, `source_monthly_count`, `source_checksum`,
	`manifest_row_count`, `manifest_checksum` ON `legacy_cutover_sources`
WHEN OLD.`manifest_checksum` IS NOT NULL AND (
	NEW.`source_appliance_count` IS NOT OLD.`source_appliance_count`
	OR NEW.`source_monthly_count` IS NOT OLD.`source_monthly_count`
	OR NEW.`source_checksum` IS NOT OLD.`source_checksum`
	OR NEW.`manifest_row_count` IS NOT OLD.`manifest_row_count`
	OR NEW.`manifest_checksum` IS NOT OLD.`manifest_checksum`
)
BEGIN SELECT RAISE(ABORT, 'legacy cutover baseline is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_target_appliance_insert`
AFTER INSERT ON `household_appliances`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'pending', `verified_at` = NULL, `sealed_at` = NULL
	WHERE `household_id` = NEW.`household_id` AND `verification_status` = 'verified'
		AND EXISTS (SELECT 1 FROM `households` WHERE `id` = NEW.`household_id` AND `status` = 'quarantined');
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'relational' AND `source_key` = CAST(NEW.`household_id` AS text)
		AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_target_appliance_update`
AFTER UPDATE ON `household_appliances`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'pending', `verified_at` = NULL, `sealed_at` = NULL
	WHERE `household_id` IN (OLD.`household_id`, NEW.`household_id`) AND `verification_status` = 'verified'
		AND EXISTS (SELECT 1 FROM `households` WHERE `id` = `legacy_cutover_sources`.`household_id` AND `status` = 'quarantined');
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'relational' AND `source_key` IN (CAST(OLD.`household_id` AS text), CAST(NEW.`household_id` AS text))
		AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_target_appliance_delete`
AFTER DELETE ON `household_appliances`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'pending', `verified_at` = NULL, `sealed_at` = NULL
	WHERE `household_id` = OLD.`household_id` AND `verification_status` = 'verified'
		AND EXISTS (SELECT 1 FROM `households` WHERE `id` = OLD.`household_id` AND `status` = 'quarantined');
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'relational' AND `source_key` = CAST(OLD.`household_id` AS text)
		AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_target_monthly_insert`
AFTER INSERT ON `household_monthly_energy_records`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'pending', `verified_at` = NULL, `sealed_at` = NULL
	WHERE `household_id` = NEW.`household_id` AND `verification_status` = 'verified'
		AND EXISTS (SELECT 1 FROM `households` WHERE `id` = NEW.`household_id` AND `status` = 'quarantined');
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_target_monthly_update`
AFTER UPDATE ON `household_monthly_energy_records`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'pending', `verified_at` = NULL, `sealed_at` = NULL
	WHERE `household_id` IN (OLD.`household_id`, NEW.`household_id`) AND `verification_status` = 'verified'
		AND EXISTS (SELECT 1 FROM `households` WHERE `id` = `legacy_cutover_sources`.`household_id` AND `status` = 'quarantined');
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_target_monthly_delete`
AFTER DELETE ON `household_monthly_energy_records`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'pending', `verified_at` = NULL, `sealed_at` = NULL
	WHERE `household_id` = OLD.`household_id` AND `verification_status` = 'verified'
		AND EXISTS (SELECT 1 FROM `households` WHERE `id` = OLD.`household_id` AND `status` = 'quarantined');
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_target_config_update`
AFTER UPDATE OF `name`, `province`, `electricity_provider`, `tariff_product_id` ON `households`
WHEN OLD.`status` = 'quarantined' AND NEW.`status` = 'quarantined' AND (
	NEW.`name` IS NOT OLD.`name` OR NEW.`province` IS NOT OLD.`province`
	OR NEW.`electricity_provider` IS NOT OLD.`electricity_provider`
	OR NEW.`tariff_product_id` IS NOT OLD.`tariff_product_id`
)
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'pending', `verified_at` = NULL, `sealed_at` = NULL
	WHERE `household_id` = NEW.`id` AND `verification_status` = 'verified';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_relational_source_update`
AFTER UPDATE OF `public_id`, `name`, `province`, `electricity_provider`, `tariff_product_id` ON `households`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'relational' AND `source_key` = CAST(NEW.`id` AS text)
		AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_relational_source_delete`
AFTER DELETE ON `households`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'relational' AND `source_key` = CAST(OLD.`id` AS text)
		AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_saved_insert`
AFTER INSERT ON `saved_home_appliances`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'saved-home' AND `source_key` = NEW.`household_key` AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_saved_update`
AFTER UPDATE ON `saved_home_appliances`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'saved-home' AND `source_key` IN (OLD.`household_key`, NEW.`household_key`)
		AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_saved_delete`
AFTER DELETE ON `saved_home_appliances`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'saved-home' AND `source_key` = OLD.`household_key` AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_legacy_monthly_insert`
AFTER INSERT ON `monthly_energy_records`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'saved-home' AND `source_key` = NEW.`household_key` AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_legacy_monthly_update`
AFTER UPDATE ON `monthly_energy_records`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'saved-home' AND `source_key` IN (OLD.`household_key`, NEW.`household_key`)
		AND `verification_status` != 'claimed';
END;
--> statement-breakpoint
CREATE TRIGGER `legacy_cutover_legacy_monthly_delete`
AFTER DELETE ON `monthly_energy_records`
BEGIN
	UPDATE `legacy_cutover_sources` SET `verification_status` = 'blocked', `source_drift` = 1,
		`verified_at` = NULL, `sealed_at` = NULL
	WHERE `source_kind` = 'saved-home' AND `source_key` = OLD.`household_key` AND `verification_status` != 'claimed';
END;
