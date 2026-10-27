-- Separate SECTOR database only. Never apply to former Her An Borsa bindings.
CREATE TABLE IF NOT EXISTS sources (
 id TEXT PRIMARY KEY, config TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 next_poll INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 etag TEXT, modified TEXT, failures INTEGER NOT NULL DEFAULT 0,
 last_ok INTEGER, last_error TEXT, last_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS articles (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), url TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, summary TEXT NOT NULL, published_at TEXT NOT NULL, first_seen INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', document TEXT, document_expires INTEGER,
 next_try INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 error TEXT, draft_id TEXT
);
CREATE INDEX IF NOT EXISTS articles_queue ON articles(status,next_try,published_at);
CREATE TABLE IF NOT EXISTS drafts (
 id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 content TEXT NOT NULL, documents TEXT NOT NULL, verification TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, defer_until INTEGER,
 message_id INTEGER, delivered_at INTEGER, delivery_state TEXT NOT NULL DEFAULT 'waiting',
 delivery_attempts INTEGER NOT NULL DEFAULT 0, next_delivery INTEGER NOT NULL DEFAULT 0,
 media_key TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS actions (
 update_id INTEGER PRIMARY KEY, draft_id TEXT, action TEXT NOT NULL, actor TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS edits (user_id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,expires_at INTEGER NOT NULL,prompt_message_id INTEGER);
CREATE TABLE IF NOT EXISTS publication_log (
 id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,target TEXT NOT NULL,
 status TEXT NOT NULL,created_at INTEGER NOT NULL,remote_id TEXT,
 UNIQUE(draft_id,revision,target)
);
CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_jobs (
 id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id), documents TEXT NOT NULL,
 related_ids TEXT NOT NULL DEFAULT '[]', input_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 result_draft TEXT, error TEXT, kind TEXT NOT NULL DEFAULT 'initial', draft_id TEXT,
 expected_revision INTEGER NOT NULL DEFAULT 0, edit_request TEXT, UNIQUE(article_id,expected_revision)
);
-- Owner-submitted URLs, PDFs and text. Independent of automatic source filtering.
CREATE TABLE IF NOT EXISTS manual_requests (
 update_id INTEGER PRIMARY KEY,message_id INTEGER NOT NULL,kind TEXT NOT NULL,input TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued',created_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,job_id TEXT,error TEXT,notified INTEGER NOT NULL DEFAULT 0
);
-- News previews never reserve model quota. Only an authenticated button click does.
CREATE TABLE IF NOT EXISTS news_cards (
 id TEXT PRIMARY KEY,article_id TEXT NOT NULL UNIQUE REFERENCES articles(id),
 state TEXT NOT NULL DEFAULT 'waiting',message_id INTEGER,created_at INTEGER NOT NULL,
 requested_at INTEGER,next_try INTEGER NOT NULL DEFAULT 0,parent_id TEXT REFERENCES news_cards(id)
);
CREATE INDEX IF NOT EXISTS news_cards_state ON news_cards(state,requested_at);
-- Local render work is separate from model jobs and consumes no AI calls.
CREATE TABLE IF NOT EXISTS card_redesigns (
 update_id INTEGER PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES drafts(id),
 revision INTEGER NOT NULL,message_id INTEGER NOT NULL,layout TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued',created_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,error TEXT
);
CREATE INDEX IF NOT EXISTS card_redesigns_state ON card_redesigns(state,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS card_redesigns_active ON card_redesigns(draft_id) WHERE state IN ('queued','rendering');
-- Bounded model recovery and diagnostic reasons; never a delivery receipt.
CREATE TABLE IF NOT EXISTS model_reviews (
 job_id TEXT PRIMARY KEY REFERENCES model_jobs(id), issues TEXT NOT NULL DEFAULT '[]',
 retries INTEGER NOT NULL DEFAULT 0, next_retry INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
-- Durable incoming Telegram queue and per-update outgoing-effect receipts.
-- Terminal updates keep status/error metadata, not the user's message payload.
CREATE TABLE IF NOT EXISTS telegram_updates (
 update_id INTEGER PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',
 attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,error TEXT,created_at INTEGER NOT NULL,finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS telegram_updates_due ON telegram_updates(state,next_try,update_id);
CREATE TABLE IF NOT EXISTS telegram_effects (
 id TEXT PRIMARY KEY,update_id INTEGER NOT NULL,method TEXT NOT NULL,state TEXT NOT NULL,
 result TEXT,error_code INTEGER,updated_at INTEGER NOT NULL
);
-- Explicit owner-authorized X publications only; failed attempts remain auditable.
CREATE TABLE IF NOT EXISTS x_posts (
 id TEXT PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES drafts(id),revision INTEGER NOT NULL,
 day TEXT NOT NULL,state TEXT NOT NULL,content TEXT NOT NULL,media_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,started_at INTEGER,finished_at INTEGER,remote_id TEXT,error TEXT,update_id INTEGER UNIQUE
);
CREATE TABLE IF NOT EXISTS x_schedules (
 post_id TEXT PRIMARY KEY REFERENCES x_posts(id), due_at INTEGER NOT NULL, media_hashes TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS x_posts_day ON x_posts(day,state);
CREATE UNIQUE INDEX IF NOT EXISTS x_posts_once ON x_posts(draft_id) WHERE state IN ('queued','uploading','posting','sent','uncertain');
-- Manual publication declarations; API receipts remain in x_posts.
CREATE TABLE IF NOT EXISTS publication_marks (
 draft_id TEXT PRIMARY KEY REFERENCES drafts(id), state TEXT NOT NULL,
 published_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_actions (update_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS publication_time_edits (user_id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,prompt_message_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
-- Additive editor migration; no existing source, queue or delivery row is rewritten.
CREATE TABLE IF NOT EXISTS news_candidates (
 id TEXT PRIMARY KEY,article_id TEXT NOT NULL,url TEXT NOT NULL UNIQUE,source_id TEXT NOT NULL,
 title TEXT NOT NULL,summary TEXT NOT NULL,published_at TEXT,first_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 route TEXT NOT NULL,reasons TEXT NOT NULL,confidence TEXT NOT NULL,rule_version TEXT NOT NULL,evaluated_at INTEGER NOT NULL,
 legacy_eligible INTEGER NOT NULL,eligible INTEGER NOT NULL,signature TEXT NOT NULL,event_group TEXT NOT NULL,suggestions TEXT NOT NULL DEFAULT '[]',family TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS news_candidates_route ON news_candidates(route,eligible,evaluated_at);
CREATE TABLE IF NOT EXISTS news_feedback (update_id INTEGER PRIMARY KEY,candidate_id TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS news_digest_runs (id TEXT PRIMARY KEY,state TEXT NOT NULL,created_at INTEGER NOT NULL,message_id INTEGER,error TEXT,items TEXT NOT NULL DEFAULT '[]',attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS editor_corrections (update_id INTEGER PRIMARY KEY,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,path TEXT NOT NULL,before_value TEXT NOT NULL,after_value TEXT NOT NULL,unit TEXT,period TEXT,created_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'proposed');
CREATE TABLE IF NOT EXISTS editor_prompts (user_id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,message_id INTEGER NOT NULL,kind TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS publication_snapshots (id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,published_at INTEGER NOT NULL,method TEXT NOT NULL,text TEXT NOT NULL,content TEXT NOT NULL,source_urls TEXT NOT NULL,media_key TEXT NOT NULL,media_hash TEXT,remote_url TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS publication_snapshots_draft ON publication_snapshots(draft_id,method,published_at);

CREATE INDEX IF NOT EXISTS news_candidates_evaluated ON news_candidates(evaluated_at);
CREATE UNIQUE INDEX IF NOT EXISTS news_candidates_article ON news_candidates(article_id);
CREATE INDEX IF NOT EXISTS news_candidates_group ON news_candidates(event_group);
CREATE INDEX IF NOT EXISTS news_candidates_expiry ON news_candidates(expires_at);
CREATE TABLE IF NOT EXISTS news_event_links (child_id TEXT NOT NULL,parent_id TEXT NOT NULL,actor TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(child_id,parent_id));

CREATE UNIQUE INDEX IF NOT EXISTS publication_snapshots_event ON publication_snapshots(draft_id,method,published_at);
-- Telegram UI: independent owner interests; existing detailed feedback and routes remain untouched.
CREATE TABLE IF NOT EXISTS news_interests (actor TEXT NOT NULL,article_id TEXT NOT NULL,candidate_id TEXT,source_id TEXT NOT NULL,choice TEXT CHECK(choice IN ('like','dislike') OR choice IS NULL),update_id INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(actor,article_id));
CREATE TABLE IF NOT EXISTS news_interest_actions (update_id INTEGER PRIMARY KEY,actor TEXT NOT NULL,article_id TEXT NOT NULL,choice TEXT NOT NULL,created_at INTEGER NOT NULL);
-- Independent report receipts, using the existing drafts/delivery/publication ledgers.
CREATE TABLE IF NOT EXISTS buyback_reports (
 id TEXT PRIMARY KEY,url TEXT NOT NULL,image_url TEXT NOT NULL,image_hash TEXT NOT NULL,
 published_at TEXT NOT NULL,day TEXT,semantic_hash TEXT,state TEXT NOT NULL,
 result_draft TEXT,error TEXT,evidence TEXT,created_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,
 UNIQUE(url,image_hash)
);
CREATE TABLE IF NOT EXISTS buyback_days (
 day TEXT PRIMARY KEY,producer TEXT NOT NULL,draft_id TEXT NOT NULL,version TEXT NOT NULL
);
-- Minimal editor audit metadata, no full article or source body. Votes remain untouched.
CREATE TABLE IF NOT EXISTS news_interest_context (
 actor TEXT NOT NULL, article_id TEXT NOT NULL, title TEXT, url TEXT, source_id TEXT,
 saved_at INTEGER NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY(actor,article_id)
);
CREATE TABLE IF NOT EXISTS news_interest_snapshots (
 update_id INTEGER PRIMARY KEY, actor TEXT NOT NULL, article_id TEXT NOT NULL,
 result_choice TEXT, decision TEXT, captured_at INTEGER NOT NULL
);
-- A lookup today cannot reconstruct the decision when a legacy button was pressed.
INSERT OR IGNORE INTO news_interest_context(actor,article_id,title,url,source_id,saved_at,provenance)
 SELECT i.actor,i.article_id,COALESCE(a.title,(SELECT title FROM news_candidates WHERE article_id=i.article_id ORDER BY evaluated_at DESC LIMIT 1)),COALESCE(a.url,(SELECT url FROM news_candidates WHERE article_id=i.article_id ORDER BY evaluated_at DESC LIMIT 1)),i.source_id,CAST(strftime('%s','now') AS INTEGER)*1000,'migration_lookup'
 FROM news_interests i LEFT JOIN articles a ON a.id=i.article_id;
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
