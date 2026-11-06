CREATE TABLE `focus_item` (
	`kind` text NOT NULL,
	`arr_id` integer NOT NULL,
	`position` integer NOT NULL,
	`added_by` text,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `arr_id`),
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "focus_item_kind_check" CHECK(kind IN ('movie', 'series'))
);
