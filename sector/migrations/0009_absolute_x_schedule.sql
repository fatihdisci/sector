-- Owner-confirmed absolute schedule intents. No existing queue rows are rewritten.
CREATE TABLE IF NOT EXISTS x_schedule_intents (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, chat_id TEXT NOT NULL, draft_id TEXT NOT NULL REFERENCES drafts(id),
 revision INTEGER NOT NULL, card_message_id INTEGER NOT NULL, content TEXT NOT NULL, media_key TEXT NOT NULL, media_hashes TEXT NOT NULL,
 created_update_id INTEGER NOT NULL UNIQUE, prompt_message_id INTEGER, input_message_id INTEGER, confirmation_message_id INTEGER,
 due_at INTEGER, state TEXT NOT NULL DEFAULT 'input', expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS x_schedule_bindings (
 post_id TEXT PRIMARY KEY REFERENCES x_posts(id), draft_id TEXT NOT NULL REFERENCES drafts(id), revision INTEGER NOT NULL,
 content TEXT NOT NULL, media_key TEXT NOT NULL, valid_until INTEGER NOT NULL
);
