CREATE TABLE `household_claim_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_by_user_id` integer,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `legacy_cutover_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_household_claim_tokens_source` ON `household_claim_tokens` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_household_claim_tokens_hash` ON `household_claim_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_household_claim_tokens_expiry` ON `household_claim_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `legacy_cutover_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`code` text NOT NULL,
	`source_table` text NOT NULL,
	`source_row_id` text,
	`details` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `legacy_cutover_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_legacy_cutover_issues_source` ON `legacy_cutover_issues` (`source_id`,`code`);--> statement-breakpoint
CREATE TABLE `legacy_cutover_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_kind` text NOT NULL,
	`source_key` text NOT NULL,
	`household_id` integer NOT NULL,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`source_appliance_count` integer DEFAULT 0 NOT NULL,
	`copied_appliance_count` integer DEFAULT 0 NOT NULL,
	`source_monthly_count` integer DEFAULT 0 NOT NULL,
	`copied_monthly_count` integer DEFAULT 0 NOT NULL,
	`source_checksum` text,
	`target_checksum` text,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "legacy_cutover_sources_kind_check" CHECK("legacy_cutover_sources"."source_kind" IN ('relational', 'saved-home')),
	CONSTRAINT "legacy_cutover_sources_status_check" CHECK("legacy_cutover_sources"."verification_status" IN ('pending', 'verified', 'blocked', 'claimed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legacy_cutover_sources_kind_key` ON `legacy_cutover_sources` (`source_kind`,`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legacy_cutover_sources_household` ON `legacy_cutover_sources` (`household_id`);--> statement-breakpoint
CREATE INDEX `idx_legacy_cutover_sources_status` ON `legacy_cutover_sources` (`verification_status`);
--> statement-breakpoint
CREATE TRIGGER `household_claim_tokens_consume`
AFTER UPDATE OF `consumed_at` ON `household_claim_tokens`
WHEN OLD.`consumed_at` IS NULL AND NEW.`consumed_at` IS NOT NULL
BEGIN
	INSERT INTO `household_members` (`household_id`, `user_id`, `role`, `created_at`, `updated_at`)
	SELECT `household_id`, NEW.`claimed_by_user_id`, 'owner', NEW.`consumed_at`, NEW.`consumed_at`
	FROM `legacy_cutover_sources`
	WHERE `id` = NEW.`source_id` AND `verification_status` = 'verified';
	UPDATE `households` SET `status` = 'active', `updated_at` = NEW.`consumed_at`
	WHERE `id` = (SELECT `household_id` FROM `legacy_cutover_sources` WHERE `id` = NEW.`source_id`)
		AND `status` = 'quarantined' AND changes() = 1;
	UPDATE `legacy_cutover_sources`
	SET `verification_status` = 'claimed', `claimed_at` = NEW.`consumed_at`, `updated_at` = NEW.`consumed_at`
	WHERE `id` = NEW.`source_id` AND changes() = 1;
END;
