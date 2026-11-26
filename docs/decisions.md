# Decisions

Dated decisions for this repo, newest last.

- 2026-11-25: created from the ops starter kit, area `co-plugins`.
- 2026-11-25 (owner, relayed by Garfunkel, bottle 197): "Extant ape plugin that Simon creates and Garfunkel builds. It should report a count of all roles, positions, etc… both high level and granular." Garfunkel builds it through pull requests; only the owner merges.
- 2026-11-25 (owner, via Simon: "Public now, coming soon (Recommended)"): public from the start with a coming-soon README, MIT, Copyright (c) 2026 EXTANT APE, and D256 access (the garfunkel-contributors team can push branches, the default branch is owner-only, v* and desktop-v* tags are owner-only).
- 2026-11-25: `package.json` is the single source for the description and keywords. It says `"private": true` and version 0.0.0 until the first release is planned, so nothing can be published to npm by accident. Removing it is part of that release, and publishing stays the owner's.
- 2026-11-25 (owner, Garfunkel chat, Captive Origins task K5467): "It should report a count of all roles, positions, etc… both high level and granular. That way we can leave our admin accounts in. It should also show us as keeper accounts if we have them (which we do, so we count). Also… let's do stats on how many keepers have more than X animals at a few different points, and any other anonymous things that are good for us to know but that never look at the person themselves". The first version follows it: a user with several values counts in each, so admin accounts stay in; count bands answer "more than X"; every read is a count.
- 2026-11-25 (shape agreed between the two chiefs, built in K5467): a generic plugin with nothing site-specific in the code; aggregate only; counts under a configurable minimum (default 5) shown as "fewer than 5", with complementary suppression; admin-only card, view and read-only JSON endpoint; access as a config function defaulting to the users collection's admin check.
- 2026-11-25 (builder's choices in K5467, open to review):
  - **Zero counts as small.** "Fewer than 5" covers 0, as the agreed wording says. A zero identifies nobody, so the hiding engine does not spend other rows protecting it, and a reader can sometimes tell a hidden count is zero or is at least 1. Nothing narrower.
  - **What counts as reachable by subtraction.** Rows that sum to a total, roll-ups, a row against its total ("everyone except"), and neighboring steps of the band and new-account ladders. This is stricter than hiding listed rows only: 48 of 50 holding a value hides the 48.
  - **"More than N" is strict.** A threshold of 1 means two or more; 0 means at least one.
  - **New-account windows are whole UTC days that have ended**, so they change once a day and today's sign-ups are in none of them.
  - **No access check, no start.** With no `access` option and no `access.admin` on the users collection, the plugin throws at start-up.
  - **Relationships to auth collections are refused** as a field to count by, since the row labels would be people.
  - **Count bands need MongoDB** for now; on another adapter the band says it is unavailable. Field counts use Payload's `count`.
  - **Too few users:** when hiding every number still lets the labels narrow a small count, every cell shows "hidden".
