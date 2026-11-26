# Test audit

Kept by this repo's owning session, per `~/Code/CLAUDE.md`, "Test self-audits". Newest first.

## 2026-11-25: first version (K5467)

Promises, from the README and `docs/decisions.md`, and the tests that hold them:

- **Counts are right** (totals, windows, fields, roll-ups, arrays, relationships, bands): `test/stats.test.ts`, "the numbers".
- **Aggregate only, no user loaded:** "reads users only by counting" spies on every find path. **No name, email or ID in any output:** "aggregate only", over the JSON, the card and the view.
- **Small counts never show:** `test/suppress.test.ts` "small counts"; `stats.test.ts` "hiding small groups", including that no hidden number is in the response.
- **No small count can be worked out:** `suppress.test.ts` "complementary suppression" (each rule), and "against a reader who tries every possibility" (`test/attacker.ts`, a brute-force check that shares no code with the engine, over random reports of each shape and all shapes together). One test proves the reader catches a report with the rule turned off.
- **Admins only, fail closed:** `stats.test.ts` "admins only" and "the admin card and view": logged out, no role, three other roles, another auth collection, custom access answers that are not `true`, a throw, and a 500 that carries no detail.
- **Read-only:** one GET endpoint, no collection added.
- **Bad options stop the boot:** `test/config.test.ts`, 21 refusals.
- **Tests clean up:** `test/mongo-setup.ts` removes the one container it started, by the name it recorded. Checked by hand after runs: no container left.

Gaps skipped, and why:

- The view's page frame (`DefaultTemplate`) and the import map need a running Next app. Too heavy for this pass; listed as not tested in the CHANGELOG and README. A browser check in a real admin is the next step before a release.
- Postgres and SQLite: not claimed.
- Label fallbacks for localized option labels: trivial.

Mutation checks run by hand, each failing at least one test: truthy access accepted; default access ignoring the collection; 403 removed; no complementary suppression; "hidden" treated as unbounded; zero shown exactly; deleted owners counted; windows running to now; "more than" as "at least".

## 2026-11-25: first audit (starter kit)

- Promises: none yet.
- Covered: none yet.
- Gaps added: none.
- Gaps skipped (and why): none.
