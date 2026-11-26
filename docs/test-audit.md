# Test audit

Kept by this repo's owning session, per `~/Code/CLAUDE.md`, "Test self-audits". Newest first.

## 2026-11-25: after the third review

- **Virtual fields that read through a relationship are refused:** `test/config.test.ts`, three refusals (the field, a group on the path, a band field). A plain `virtual: true` field is accepted.
- **Any truthy `hidden` is refused:** `config.test.ts`, `hidden: 1`.
- **Collection-level read hooks need an opt-in:** `config.test.ts`, seven refusals (afterRead and beforeRead on users and on a band collection, an opt-in for a different collection, two bad values of the option), and one test that the opt-in works, that hooks about writing need none, and that a category collection with a hook is accepted.
- **The second check:** `config.test.ts` with a stand-in for the started Payload: nothing is counted before it runs, the site's own `onInit` runs first, and a later change (a hidden field, a new read hook) turns the stats off with the reason logged and a 503 that names no field. `test/stats.test.ts` on a real second Payload and database, with a later plugin that hides `isMinor`: the reason is in the real start-up log, the endpoint answers 503, the view and the card show no numbers, and `payload.count` is never called. The main suite's site passes the second check on its real sanitized config.

Gaps skipped, and why:

- A later plugin adding a collection read hook, on a real Payload: the stand-in covers it, and the real test covers the same path with a hidden field.
- What a three-value field with a roll-up gives away beyond the overlap. The README states it in words (bounds, never an exact number), as the review described it. No test measures those bounds.

## 2026-11-25: after the second review

What changed, and the tests that hold it:

- **Hidden fields, fields under a hidden group and fields with an afterRead hook are refused:** `test/config.test.ts`, seven refusals (a hidden select, a hidden group on the path, an afterRead hook on the field and on an array on the path, a hidden title field, a hidden band field, a band field with an afterRead hook). A field whose hooks do not touch reading is accepted.
- **Two bands on one field are refused:** `config.test.ts`, with different thresholds and with the same. `suppress.test.ts` shows why: the reader finds the leak on that shape, with the review's numbers.
- **A zero reads 0:** `suppress.test.ts` "shows a zero in a table that shows as 0", and `stats.test.ts` against the real database. No response holds "fewer than".
- **The readers are independent of the layout:** `test/exhaustive.ts` and `test/attacker.ts` take a shape as kinds of user, the counts those users give, and the groups to protect. The page comes from `present`, the one function everything published passes through. Eight shapes pass at minimums 2, 3 and 5: the six from before, a many-value field with two values, and two fields shown together. For one-value fields, ladders and bands, the protected groups are every group made of a table's parts. For many-value fields they are each row, each roll-up, any, none, and the users with some value (or some value of a roll-up) who lack one.
- **Accepted limits are pinned:** the overlap in a two-value field is recoverable (the review's 10, 8, 2 and 10), what a page narrows is the overlap and what follows from it (in a two-value field, its sum with "none"), and a group spanning two fields can be narrowed.

Mutation checks, run by hand in this pass and then restored: with the roll-up member remainders taken out of `layout`, 4 tests fail (both readers, on the many-value shape with a roll-up). With the "any but this value" remainders taken out, 10 fail. Kept in the suite: the three leaky engines, the "fewer than" page, and two bands on one field.

Gaps skipped, and why:

- The new refusals against a booted Payload. They run in `resolveOptions` before Payload starts, on the same config objects, so the resolver tests are the real path. The repro site from the review was not rebuilt.
- A write landing between two counts. It needs a controlled race against the database; stated as a limit in the README and as not tested in the CHANGELOG.
- The arithmetic reader on every table at once. It works on kinds of user, and all four tables together make 512 kinds. Tables share only the public total, and the two-table shapes cover that.
- The readers at minimum 2 say little about exact sizes: the only small size is 1, so there is nothing to narrow to.

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
