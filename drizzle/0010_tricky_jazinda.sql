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
