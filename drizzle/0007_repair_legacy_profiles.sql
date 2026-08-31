-- Repair catalog rows that predate the runtime usage-profile contract.
-- Preserve a usable direct energy value when one exists, and keep unsupported categories out of the public catalog.
UPDATE `appliance_models`
SET `calculation_method` = CASE
	WHEN COALESCE(`energy_per_cycle_kwh`, 0) > 0 THEN 'per_cycle'
	WHEN COALESCE(`annual_energy_kwh`, 0) > 0 THEN 'annual_energy'
	WHEN COALESCE(`rated_power_w`, 0) > 0 THEN 'rated_power'
	ELSE `calculation_method`
END
WHERE (
	`calculation_method` IS NULL
	OR `calculation_method` NOT IN ('rated_power', 'annual_energy', 'per_cycle')
	OR (`calculation_method` = 'rated_power' AND COALESCE(`rated_power_w`, 0) <= 0)
	OR (`calculation_method` = 'annual_energy' AND COALESCE(`annual_energy_kwh`, 0) <= 0)
	OR (`calculation_method` = 'per_cycle' AND COALESCE(`energy_per_cycle_kwh`, 0) <= 0)
)
AND (
	COALESCE(`rated_power_w`, 0) > 0
	OR COALESCE(`annual_energy_kwh`, 0) > 0
	OR COALESCE(`energy_per_cycle_kwh`, 0) > 0
);
--> statement-breakpoint
UPDATE `appliance_models`
SET `calculation_method` = 'rated_power',
	`rated_power_w` = 1,
	`annual_energy_kwh` = NULL,
	`energy_per_cycle_kwh` = NULL,
	`load_factor` = NULL,
	`source_url` = NULL,
	`source_name` = 'WattWise legacy catalog (unverified)',
	`verified_at` = NULL,
	`confidence` = 'low',
	`is_active` = 0
WHERE
	`calculation_method` IS NULL
	OR `calculation_method` NOT IN ('rated_power', 'annual_energy', 'per_cycle')
	OR (`calculation_method` = 'rated_power' AND COALESCE(`rated_power_w`, 0) <= 0)
	OR (`calculation_method` = 'annual_energy' AND COALESCE(`annual_energy_kwh`, 0) <= 0)
	OR (`calculation_method` = 'per_cycle' AND COALESCE(`energy_per_cycle_kwh`, 0) <= 0);
--> statement-breakpoint
UPDATE `appliance_models`
SET `usage_profile` = CASE (
	SELECT `slug` FROM `categories` WHERE `categories`.`id` = `appliance_models`.`category_id`
)
	WHEN 'air-conditioner' THEN 'inverter_ac'
	WHEN 'refrigerator' THEN 'refrigerator'
	WHEN 'television' THEN 'television'
	WHEN 'washing-machine' THEN 'washing_machine'
	WHEN 'fan' THEN 'fan'
	WHEN 'water-heater' THEN 'water_heater'
	WHEN 'microwave' THEN 'microwave'
	WHEN 'rice-cooker' THEN 'rice_cooker_hours'
END
WHERE `category_id` IN (
	SELECT `id` FROM `categories`
	WHERE `slug` IN (
		'air-conditioner', 'refrigerator', 'television', 'washing-machine',
		'fan', 'water-heater', 'microwave', 'rice-cooker'
	)
);
--> statement-breakpoint
UPDATE `appliance_models`
SET `is_active` = 0,
	`usage_profile` = CASE `calculation_method`
		WHEN 'annual_energy' THEN 'refrigerator'
		WHEN 'per_cycle' THEN 'washing_machine'
		ELSE 'fan'
	END
WHERE `category_id` NOT IN (
	SELECT `id` FROM `categories`
	WHERE `slug` IN (
		'air-conditioner', 'refrigerator', 'television', 'washing-machine',
		'fan', 'water-heater', 'microwave', 'rice-cooker'
	)
);
