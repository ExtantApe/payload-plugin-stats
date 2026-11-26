# Test audit

Kept by this repo's owning session, per `~/Code/CLAUDE.md`, "Test self-audits". Newest first.

## 2026-11-25: first version, after the Head of Tools review

Promises, from the README and `docs/decisions.md`, and the tests that hold them:

- **Counts are right** (totals, windows, fields, roll-ups, arrays, relationships, bands): `test/stats.test.ts`, "the numbers".
- **Aggregate only, no user loaded:** "reads users only by counting" spies on every find path. **No name, email or ID in any output:** "aggregate only", over the JSON, the card and the view.
- **No count from 1 to minimum - 1 shows; a zero reads "fewer than":** `test/suppress.test.ts` "small counts"; `stats.test.ts` "hiding small groups", including that no hidden number is in the response.
- **The total is always exact:** `suppress.test.ts` "the total is public", and every random report in the arithmetic check.
- **Hiding is by structure:** `suppress.test.ts` "hiding by structure", one test per rule (rows together, "any" and "none", overlapping values, roll-ups, ladders, counts that disagree), with the same pattern asserted across different sizes.
- **The pattern of hidden cells gives nothing away, to a reader who knows the code:** `suppress.test.ts` "every possible site" with `test/exhaustive.ts`. Six shapes (windows, a one-value field with a roll-up, a one-value field with two roll-ups that share a value, a many-value field with a roll-up, a band, windows with a band), every split of up to 9 to 20 users, at minimums 2, 3 and 5. Three tests prove the check sees a leak: small counts hidden alone, a neighbor picked by size (the first version's flaw), and the real engine with "fewer than" labels kept in hidden tables or with nesting removed.
- **No small count can be worked out by arithmetic:** "random larger sites" with `test/attacker.ts`, a brute-force reader that shares no code with the engine, at minimums 3 and 5 with the total known, over each shape and all together. One test proves it catches a report with nothing extra hidden.
- **Only who `access` allows, fail closed:** `stats.test.ts` "admins only" and "the admin card and view": logged out, no role, three other roles, a user who may open the admin panel, another auth collection, custom access answers that are not `true`, a throw, and a 500 that carries no detail.
- **`access` is a required function:** `test/config.test.ts`, no options, no `access`, and eight values that are not functions, through `resolveOptions` and through `stats()`.
- **Relationships need `categories`:** `config.test.ts`: not listed, another collection listed, a missing or auth collection listed, accounts listed.
- **Fields with their own read access are refused:** `config.test.ts`: a read rule that says no, one that says yes, a group and an array on the path, a band field, a title field. A field with only an update rule is accepted.
- **Read-only:** one GET endpoint, no collection added.
- **Other bad options stop the boot:** `config.test.ts`, 32 refusals in one table, the access and relationship ones above among them.
- **Tests clean up:** `test/mongo-setup.ts` removes the one container it started, by the name it recorded. `test/cleanup.test.ts` covers exit, SIGINT, SIGTERM and SIGHUP with a stand-in process. Checked by hand with real SIGTERM and SIGINT during a run, and after full runs: no container left.

Gaps skipped, and why:

- The view's page frame (`DefaultTemplate`) and the import map need a running Next app. Too heavy for this pass; listed as not tested in the CHANGELOG and README. A browser check in a real admin is the next step before a release.
- The exhaustive check on larger shapes (more than four values, three or more roll-ups, two fields at once). Tables share nothing but the public total, so each is checked on its own; the argument for larger fields is the same and is not run.
- A reader comparing reports saved over time: out of scope for one report, stated as a limit in the README.
- Postgres and SQLite: not claimed.
- Label fallbacks for localized option labels: trivial.

Mutation checks. Kept in the suite: the four leaky engines above. Run by hand on the engine during this pass, each failing the exhaustive check on every shape tried: nesting removed, and "fewer than" labels kept in hidden tables.

## 2026-11-25: first audit (starter kit)

- Promises: none yet.
- Covered: none yet.
- Gaps added: none.
- Gaps skipped (and why): none.
