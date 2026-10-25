CREATE TABLE IF NOT EXISTS news_digest_pages (
 slot_id TEXT NOT NULL,page INTEGER NOT NULL,items TEXT NOT NULL,actual_items TEXT NOT NULL DEFAULT '[]',
 state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,expired_count INTEGER NOT NULL DEFAULT 0,error TEXT,message_id INTEGER,
 PRIMARY KEY(slot_id,page)
);
CREATE INDEX IF NOT EXISTS news_digest_pages_state ON news_digest_pages(state,expires_at);
CREATE TABLE IF NOT EXISTS news_owner_route_reviews (
 id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,actor TEXT NOT NULL,label TEXT NOT NULL,
 context TEXT NOT NULL,approval_source TEXT NOT NULL,rule_version TEXT NOT NULL,catalog_version TEXT NOT NULL,
 code_hash TEXT NOT NULL,catalog_hash TEXT NOT NULL,scope_hash TEXT NOT NULL,sample_hash TEXT NOT NULL,
 evidence TEXT NOT NULL,recorded_at INTEGER NOT NULL
);
