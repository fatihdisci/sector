CREATE TABLE IF NOT EXISTS kap_previews (queue_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, message_id INTEGER, selected_at INTEGER);
