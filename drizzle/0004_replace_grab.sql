CREATE TABLE `replace_grab` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app` text NOT NULL,
	`guid` text NOT NULL,
	`download_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "replace_grab_app_check" CHECK(app IN ('radarr', 'sonarr'))
);
