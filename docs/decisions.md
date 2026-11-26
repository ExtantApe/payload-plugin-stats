# Decisions

Dated decisions for this repo, newest last.

- 2026-11-25: created from the ops starter kit, area `co-plugins`.
- 2026-11-25 (owner, relayed by Garfunkel, bottle 197): "Extant ape plugin that Simon creates and Garfunkel builds. It should report a count of all roles, positions, etc… both high level and granular." Garfunkel builds it through pull requests; only the owner merges.
- 2026-11-25 (owner, via Simon: "Public now, coming soon (Recommended)"): public from the start with a coming-soon README, MIT, Copyright (c) 2026 EXTANT APE, and D256 access (the garfunkel-contributors team can push branches, the default branch is owner-only, v* and desktop-v* tags are owner-only).
- 2026-11-25: `package.json` is the single source for the description and keywords. It says `"private": true` and version 0.0.0 until the first release is planned, so nothing can be published to npm by accident. Removing it is part of that release, and publishing stays the owner's.
