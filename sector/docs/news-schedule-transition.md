# Schedule-only owner acceptance

Owner answer Sentinel_d8281e0383e08191854491c351f808b5 approves 10:30,14:30,18:30,22:30 Europe/Istanbul instead of 12:30,18:30. The acceptance timestamp is actual receipt recording time, not an invented user message timestamp.

The immutable parent investor-v6 binding, readiness record, twelve labels, catalog, watchlist, activated_at and preview cutoff stay unchanged. A separate schedule record binds the new distinct scope hashes, exact four hours, owner/source/time, parent binding hash and new runtime source matrix. The readiness adapter validates both the schedule successor and the original editorial proof. It explicitly reports current runtime artifact separately from the parent editorial-approved artifact; the old hash is never relabelled as new. Unapproved source, catalog, rule, watchlist, cutoff, code or time changes reject readiness.

Scheduler slot eligibility begins at max(activated_at,schedule_since). Content selection still begins at activated_at. Thus earlier daily slots are not caught up and existing eligible content is not lost. Empty selections remain silent and instant news does not use the schedule. No manual selection/test/X post.

Tests cover wrong/duplicate hours, stale scope, forged/missing approval, wrong owner/time, changed parent/editorial/catalog/watchlist/cutoff/runtime and disabled delivery, plus fixed-clock prospective first slot, silent empty run and eligible pre-change content retained at 22:30. No schema migration. Installation is isolated news-only from d1056cd with an unchanged KAP/panel source proof. The admin apply is atomic and preserves original settings except digest_times and schedule_since; it runs before the staged activation marker releases workers.

## Hourly selection successor

The hourly-selection candidate binds `Europe/Istanbul`, every `HH:00` slot, and the quiet delivery window `00:00–08:00` into its artifact hash. A valid owner callback records one successor linked to the unchanged prior schedule approval, exact candidate hash, owner, private chat, message, nonce, and approval time. Existing preference hours and the prior transition remain unchanged until an explicitly staged settings migration; runtime derives effective hours from the validated successor. If readiness or installation fails, the old runtime continues using its existing hours. The minute-level source polling interval and content/AI gates do not change.

The existing digest run/page ledger supplies the three-day measurement: compare candidate IDs, selected snapshot IDs, successfully delivered IDs, and any manually chosen or published IDs already recorded by the app. No empty or already-delivered selection is sent. Telegram pages from midnight through 07:59 TRT set `disable_notification`; 08:00 and later pages do not. Do not replay historical slots when the successor activates; its approval time is the prospective selection cutoff.
