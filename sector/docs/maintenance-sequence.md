Subsequent maintenance releases
==============================

Export only `runtime_identity.news_review_artifact` from the current runtime to a local JSON file. Do not export secrets or rewrite approval records. Generate the tested candidate with:

```
npx tsx scripts/stage_news_candidate.ts /absolute/new-candidate.json /absolute/current-artifact.json
```

The second argument selects the exact current predecessor; omitting it is only suitable for the original anchor. Generation runs the offline test/typecheck/build gates. Staging independently verifies the current artifact and its complete owner-approved predecessor chain.

```
npx tsx scripts/install_news_candidate.ts /absolute/runtime.sqlite /absolute/new-candidate.json EXPECTED_OWNER_CHAT_ID
python3 scripts/install_local.py --update --maintenance
```

The expected chat is explicit configuration, not derived from candidate/request data. Staging does not authenticate an owner, approve anything, or activate the release. New approval still requires the actual configured Telegram owner to use `/haberfiltre` and its exact-hash button during the controlled maintenance window. Do not run maintenance before exact-commit CI success and current in-flight/schedule preflight. Notify the owner of the window and deadline.

The original candidate pointer remains intact for rollback to the first deployed handler. Later candidates use a separate staged pointer. Immutable history stores only artifact/candidate data; original request and callback approval records remain under their original nonce keys. A new candidate never inherits approval. The active runtime resolves its own exact artifact even while another candidate waits. The chain is bounded to 32 successors and rejects reused hashes/nonces, gaps, altered parents and policy/catalog/schedule changes.

Timeout/abort/activation failure restores application/configuration without DB restore, offset rewind, request replay or approval deletion. A pending later candidate remains recorded for deliberate retry; staging refuses to silently replace an unrelated pending candidate. Rollback readiness uses the earlier release's own approval chain. X uncertain records and schedules must remain untouched.
