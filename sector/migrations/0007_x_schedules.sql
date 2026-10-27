CREATE TABLE IF NOT EXISTS x_schedules (post_id TEXT PRIMARY KEY REFERENCES x_posts(id), due_at INTEGER NOT NULL, media_hashes TEXT NOT NULL);
