# Decisions

Dated decisions for this repo, newest last.

- 2026-11-25: created from the ops starter kit, area `co-plugins`.
- 2026-11-25 (owner, relayed by Garfunkel, bottle 197): "Extant ape plugin that Simon creates and Garfunkel builds. It should report a count of all roles, positions, etc… both high level and granular." Garfunkel builds it through pull requests; only the owner merges.
- 2026-11-25 (owner, via Simon: "Public now, coming soon (Recommended)"): public from the start with a coming-soon README, MIT, Copyright (c) 2026 EXTANT APE, and D256 access (the garfunkel-contributors team can push branches, the default branch is owner-only, v* and desktop-v* tags are owner-only).
- 2026-11-25: `package.json` is the single source for the description and keywords. It says `"private": true` and version 0.0.0 until the first release is planned, so nothing can be published to npm by accident. Removing it is part of that release, and publishing stays the owner's.
- 2026-11-25 (owner, relayed by Garfunkel): "It should report a count of all roles, positions, etc… both high level and granular. That way we can leave our admin accounts in. It should also show us as keeper accounts if we have them (which we do, so we count). Also… let's do stats on how many keepers have more than X animals at a few different points, and any other anonymous things that are good for us to know but that never look at the person themselves". The first version follows it: a user with several values counts in each, so admin accounts stay in; count bands answer "more than X"; every read is a count.
- 2026-11-25 (shape agreed between the two chiefs): a generic plugin with nothing site-specific in the code; aggregate only; no count under a configurable minimum (default 5) shown, with further hiding so none can be worked out; a card, a view and a read-only JSON endpoint behind an access function.
- **Head of Tools, 2026-11-25**, rulings on the builder's five choices in the first pull request. All five are kept:
  - **Zero counts as small.** "Fewer than 5" covers 0. A zero identifies nobody, so nothing else is hidden to protect it.
  - **The strict subtraction rule.** Rows that sum to a total, roll-ups, a row against its total ("everyone except"), and neighboring steps of the band and new-account ladders are all reachable by subtraction and all protected. Extended: the rule also covers what the pattern of hidden cells gives away, and the total counts as known.
  - **"More than N" is strict**, the owner's wording. A threshold of 1 means two or more; 0 means at least one.
  - **No access check, no start.** Tightened: `access` is a required function with no default.
  - **Relationships to auth collections are refused.** Widened: every relationship field needs its collection named in `categories`.
- **Head of Tools, 2026-11-25**, changes required by the review of the first pull request, with the Payload security reviewer:
  - **Hide by structure, never by values.** The first engine hid the smallest exact neighbor of a small count, and the code is public, so which neighbor was hidden gave hidden counts away exactly. What to hide is now chosen from structure alone, and a test runs the engine over every value combination and checks that no published pattern narrows a small count.
  - **The total is public.** Admins can read the user count off the users list. The total is always exact and treated as known, and the attacker tests run at minimum 5 as well as 3.
  - **A relationship field needs an explicit opt-in** naming its collection as categories, for example `categories: ['positions']`. Anything else is refused at start-up, because a collection with one document per person would list every title as a row label.
  - **`access` is a required function with no default.** The users collection's `access.admin` means admin-panel access, and editors often have it. The plugin refuses to start without `access`, and the README says so.
  - **Field-level read access is respected by refusing.** Any counted field, or any field on the path to it, that has its own read access is refused at start-up.
  - **A non-function `access` is refused at start-up** (`true`, `'yes'`, `1`, `{}`, `false`, `null`).
  - **The test database container is removed on SIGINT and SIGTERM too**, not only on a normal exit.
  - **The README says that saving reports over time can reveal single changes**: rows, bands, and changes in which cells are hidden, as well as the total.
- 2026-11-25 (builder's choices in carrying those out, open to review):
  - **Blocks.** Each field has one block for "any" and "none" and, nested under it, one block for all its rows and roll-ups. Each step of a ladder is a block nested under the step before. A block with a count from 1 to minimum - 1, counting the remainders nobody lists, is hidden whole, and so is everything nested under it. Splitting a field into smaller blocks was tried on paper and leaks: with "any" public, roll-ups that share a value pin a row down.
  - **Hidden says nothing of size.** The first version showed "fewer than 5" for small counts and "hidden" for large ones it was protecting. Inside a hidden table that distinction leaks (with a total of 11, a small row next to two rows known to be 5 or more must be 0 or 1), and the exhaustive test fails with it. So every count in a hidden table reads "hidden", and "fewer than 5" appears only for a zero in a table that shows. A count of 3 therefore reads "hidden", where the first version said "fewer than 5".
  - **This hides more.** One small row hides every row of its field, and roll-ups do not rescue it. That is the cost of the review's "the whole line". A site that wants more on show lowers `minimum`.
  - **What the public total rules out is not a leak.** With 3 users, no count is 4. The exhaustive test asks for every value from 1 to minimum - 1 that some site with the same total could have.
  - **Counts that disagree hide the table** (the data changed between two counts), so the engine fails closed.
  - **Also refused:** a `categories` collection's title field with its own read access, since titles are read past access control. A title field of `id` is never used as a label.
  - **The plugin does not check which auth collection the user is from.** The site's `access` function does, and the README shows how.
  - **New-account windows are whole UTC days that have ended**, so they change once a day and today's sign-ups are in none of them.
  - **Count bands need MongoDB** for now; on another adapter the band says it is unavailable. Field counts use Payload's `count`.
