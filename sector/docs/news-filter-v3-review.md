# Investor v3 — shadow-only follow-up

This patch adds short names taken from the existing sourced KAP legal titles for ARCLK, ASTOR, NETAS, BYDNR, KCHOL and THYAO. It adds catalog-constrained uppercase equity-code recognition in equity context and a realized investment/opening event. It does not infer a code for KOCHL, QNB Yatırım, Borusan or foreign Carrefour. Explicit fund-code lists are not treated as equities.

The rule and catalog versions change, invalidating any earlier readiness approval. No owner review, filter preference or delivery ledger is written by this patch. Likes are not route labels. A separate read-only comparison of 100 actual interests uses click-decision time where available; absent history remains absent. The report stays outside Git because it contains user activity.

## Acceptance and remaining decisions

Regression cases cover the actual multi-code headlines, unknown codes, ordinary nonfinancial words, fund-code lists, short aliases, ambiguous groups, decomposed Turkish characters, actual opening versus expectation/allegation/negation. Existing fake-transport tests exercise shadow-off delivery, restart/uncertain protection and explicit 429 retry.

Digest scheduling remains 12:30/18:30 Istanbul, disabled. Its existing 15-minute window and ten-item newest-first batch can miss a slot after a longer outage and can starve older items under sustained volume. These are not claimed fixed. Owner review must decide catch-up horizon and overflow policy before enabling delivery. Critical instant previews remain independent of digest slots. No replay or bulk send is authorized by this patch.

At least twelve genuine per-item route reviews, official alias/scope review and version/hash-bound evaluation acceptance are required before active mode. Do not generate those reviews from likes/dislikes. Rollback is application-only to the previous staged release; keep current SQLite and delivery ledgers, remain shadow, do not replay uncertain deliveries. No schema migration is added.

## Digest recovery follow-up (still disabled)

Automatic slots may recover for less than two hours, only on the same Istanbul calendar day and never before activation. Only the latest due slot is claimed; older missed slots are not replayed. Each slot sends at most ten event groups. Fresh candidates are ordered by first_seen/id (FIFO), not reevaluation recency; remaining candidates stay pending. Publication age is rechecked (24 hours, at most five minutes future clock tolerance), as are metadata expiry and activation cutoff. Automatic undated candidates are excluded. Event groups already sending/sent/uncertain remain suppressed. Frozen retry IDs are revalidated; only actual delivered IDs receive sent status. Explicit manual /secki retains undated review candidates.

Limits: default two slots allow at most twenty groups per day. Sustained arrival above capacity can still outlive the 24-hour freshness budget; those records are not falsely marked sent. Outages of two hours or more, prior Istanbul days and preactivation history are deliberately not replayed. A larger horizon, more slots or capacity needs a separate product decision. No live digest, owner approval, or readiness row is created by this change.
