CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`prompt` text NOT NULL,
	`aspect_ratio` text NOT NULL,
	`asset_ids_json` text NOT NULL,
	`caption` text,
	`hashtags_json` text,
	`image_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generations_brand_idx` ON `generations` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_generation_idx` ON `jobs` (`generation_id`,`created_at`);