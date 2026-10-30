# Opt-in API launcher and isolated owner-image trial

The shipped defaults are **disabled/no network**. No key, model access or current credit balance is shipped. Live Hermes remains `gpt-6.1-terra/medium`; the opt-in text and vision API preference is `gpt-6.1-terra/medium`. Image quality stays `medium` under the approved `bc-typographic-v1` contract. This code does not install, restart or modify a live service.

## One ledger, one window, one planned trial

Both config files must contain the same `shared_budget` object and canonical absolute `ledger_path`. Set `SECTOR_OPENAI_API_BUDGET` and `SECTOR_OWNER_VISUAL_BUDGET` to that **same file**, not separate family budgets. Both legacy top-level cap/window/expiry fields must exactly match the shared fields. `profiles` pins the text, vision and image models, efforts, verified token ceilings and rate values. The production CLI entry points reject a missing shared configuration **before reading the injected key**. The legacy independent ledger classes are retained solely for explicit offline regression compatibility; the production entry points do not select them.

`SharedBudget` uses SQLite `BEGIN IMMEDIATE` for the total reservation across all three families. The launcher preallocates four text, four vision and one image worst-case call before credential lookup. Each actual call consumes one family slot rather than reserving the money again. Fees for known usage settle once; cached input and reasoning are subsets, not extra tokens. Missing usage, uncertain POST, timeout or process failure retain the reservation and block replay. Unused slots are released only after explicit successful trial completion. A duplicate plan/call/job cannot silently start again. Changed window terms and replacement window IDs in the same ledger are rejected.

The owner supplied a billing screenshot on 29 October 2026 showing an available $192 balance and expiry on 27 November 2026. It is a point-in-time observation, without organization identity or an exact expiry hour/timezone, and is not fresh machine-verified authorization. Other API clients consume the same balance; it does not roll into a new month. No value defaults to the original $192 grant. Fresh external promo evidence must include `verification_id`, `remaining_micro_usd`, `observed_at`, `valid_until`, `grant_expires_at`, `other_consumption_bound_micro_usd`, `safety_margin_micro_usd`, plus explicit verified promo-only and bounded-other-consumption results. Evidence lifetime is at most 15 minutes; window expiry cannot exceed either evidence or grant expiry. A missing/unknown/stale value fails closed. The shared cap must fit the remaining balance after other-consumption bound and safety margin.

The launcher additionally requires a trusted `promo_verifier` callback to return the exact fresh evidence. The default CLI **does not manufacture that verifier** and cannot activate merely by setting an `enabled` flag. This is an external authorization boundary still requiring account/grant verification. The local ledger only knows calls routed through this application. It does not independently inspect organization credit, detect all other clients, or establish a zero-paid-spill guarantee. If promo-only account treatment and other consumption cannot be reliably verified, keep the API off. Purchased-credit fallback and auto-recharge are not authorized.

## Credential boundary

The fixed future Keychain target is:

- Service: `sectorhaber-openai-api`
- Account: `sectorhaber-news`

No item was created or read during implementation. Immediately before future credential creation/storage/lookup/injection, obtain explicit action-time approval for the selected OpenAI project and this exact target. The owner enters the project-scoped key in the operating system's secure Keychain UI, never in chat, a repository/config file, shell arguments or a pasted terminal command. The code does not create OpenAI keys or Keychain entries.

`api_launcher.launch` checks action-time approval/expiry/target, enabled model/rate/budget configs, common ledger identity, private temporary source/MEDIA paths, interpreter paths and immutable reference hashes, then trusted promo verification and the entire planned reservation. Only then may it call the credential loader. The default future loader captures one fixed `security find-generic-password` result in memory, suppresses raw errors, and passes the key solely as `SECTOR_OPENAI_API_KEY` in the API child environment. No key is placed in argv, input JSON, output, log or Hermes child environment. It does not search other Keychain items or retry lookup. Child stdout/stderr are suppressed; launcher outcomes contain only fixed status fields.

## Isolated runner

`node --import tsx scripts/isolated_api_trial.ts` defaults to a no-network dry run. Real mode needs the separate launcher approval marker and injected key; flags alone do not provide verified promo evidence. `api_launcher.launch` is the guarded callable used after the external verification integration has been separately approved. Its normal executable targets only this fixed runner.

The bundle specifies an owned 0700 directory under the system temporary directory, `source.png`, `media/`, one `shared-budget.sqlite`, explicit interpreter paths and the two nonsecret config objects. Existing DBs and live application paths are refused. The runner calls the actual `manualDocuments → OWNER_VISUAL.analyze → enqueueEvidence → leaseJob → runModelJob → renderModelJob → submitJob` exports. A trusted local file-reader injection avoids Telegram downloads; no live service module or Telegram/X consumer is imported or started. The minimum trial is a single clear image with at most eight facts and one output page. More source facts stop the minimum trial without dropping rows.

Mocks inject both visual and text HTTP functions and exercise the same Python adapters and shared SQLite ledger, including real draft normalization/validation, PNG hash/receipt validation and duplicate-submit handling. These outputs are synthetic test pixels, not evidence of actual AI reading/generation quality. Real model/network calls were not made.

## Image model recommendation, not activation

For fixed-reference financial typography, start with **`gpt-image-2.5-sunburst-2026-09-08` at medium** once separately selected/approved. Sunburst is documented for editing precision; Flare for fast everyday generation. Both public model pages show the same Standard per-million token rates at verification: text input $5, cached text $1.25; image input $8, cached image $2; image output $30. Therefore Flare is not claimed cheaper per image or token. Actual generated token counts and quality must be measured in the first approved small trial; no account access is assumed. No image model was activated in the disabled examples.

Official references: [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), [prepaid balance timing](https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing), [spend-limit timing](https://developers.openai.com/api/docs/guides/spend-limits). Rates still require an explicitly current source/effective/expiry record in the real config; this document is not an account-specific rate quote.

## MEDIA and deployment

Same-host local-service and bridge source use `~/Library/Application Support/sector-haber/media`. A remote Worker/R2 store is a different backend and cannot be assumed shared with that directory. The isolated launcher supports only its private local MEDIA directory; it creates no endpoint, credential or permission for remote transfer. Remote use first requires a separately reviewed private hash-bound transfer/shared-store arrangement. Existing nonsecret status showed the installed release lacked the new owner visual runtime; no live readiness is claimed.

Publishing requires exact-source local tests/typecheck/build and, separately, the owner's live-maintenance approval with the existing staged/backup procedure. A normal GitHub main push is not deployment permission. GitHub CI queue time is not the local publication gate. Preserve current filters, KAP scope, selection schedules and uncertain X records.


## News text-only runtime (separate from the visual trial)

`scripts/news_api_runtime.ts` is a local news-service startup path. Without a private `news-api-provider.json` it retains the existing Hermes route. The explicit control is exactly `{"version":1,"provider":"openai-api","enabled":true,"purpose":"news_text_only"}`. It never enables owner vision or image generation. The same runtime directory holds private `news-api-config.json`, `news-api-budget.sqlite`, and `news-api-usage.jsonl`; paths cannot be supplied in the control object. The Python preflight verifies the model, current rates, fresh promo evidence and shared budget before the fixed Keychain item is read. An API preflight or Keychain error stops startup; there is no silent provider fallback.

The key is captured through a private child pipe, kept in this news process, and handed only to its API child environment. It is not written into the plist, repository, configuration, telemetry, global process environment, or Hermes child. All credential subprocess failures become fixed error codes. Do not run credential extraction commands in a terminal or print the runtime object.

The existing shared ledger also accepts an explicit `families:["text"]` profile; absent this field its original three-family contract remains required. This selects no visual profiles and retains the same atomic reservation, usage settlement, expiry and replay protection. Promo evidence remains valid for at most 15 minutes. This is a real expiry boundary: live calls stop when it expires. Do not extend or automatically renew it without fresh external account/other-consumption verification. A UI balance observation alone does not establish an ongoing account-wide spending guarantee.

`scripts/news_api_smoke.py --approved-single-text-check <private-root>` is a separately approved, single text request, using the same gate, Responses transport, ledger and usage telemetry. It creates an exclusive permanent attempt marker before credential access, refuses replay, and reports only fixed outcomes plus numeric usage/cost. Unknown outcomes retain budget reservations. The default visual trial launcher is not used. This command does not import the live service or create news, drafts, posts, media, or schedules.
