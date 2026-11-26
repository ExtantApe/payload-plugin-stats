# payload-plugin-stats

Stats for Payload: admin-only counts of users by role, position and other fields, with no names, emails or IDs, and small groups hidden.

> **Status: first version, unreleased.** 72 tests pass against a real Payload 3.92 and a real MongoDB 8: the counts, the hiding rules and every refusal. The dashboard card and the admin view have been rendered to HTML in tests and have **not been opened in a browser inside a running admin yet**. Nothing is on npm, and `package.json` stays private until the first release is planned.

## What it does

- Counts all users, and new accounts yesterday, in the last 7 days and in the last 30 days.
- Counts users by each field you name, such as roles, positions or account kinds. Each field gets a high-level table (any value, no value, and roll-ups you define) and a table with one row per value.
- Counts how many users hold more than N documents in another collection, at the thresholds you choose. For example: users with more than 1, 5, 10, 25 and 50 posts.
- Shows the result to admins in three places: a card on the dashboard, an admin view at `/admin/stats`, and a JSON endpoint at `GET /api/stats`.

A user with several values in a field is counted in each of them. An admin who also holds another role counts in both rows, so admin accounts can stay in the numbers.

## What it never does

- It never loads a user. Every read of the users collection is a count. Count bands run one grouped count inside the database and bring back a single row of totals.
- It never returns a name, an email or an ID. Responses hold labels you configured and numbers.
- It never writes. The plugin adds one `GET` endpoint and no collection.

## Small groups

A count under the minimum (default 5) shows as **fewer than 5**. That covers zero.

Hiding one number is often not enough. If 40 users split into 30, 7 and a hidden 3, anyone can subtract. So the plugin also hides larger counts, shown as **hidden**, until no count from 1 to 4 can be worked out by adding or subtracting the numbers on the page. It checks:

- rows that add up to a total, and roll-ups that add up from their rows;
- a row against its total, because "everyone except these" is a group too;
- neighboring steps of a ladder: "more than 1" next to "more than 5" gives away how many hold 2 to 5, and "last 7 days" next to "yesterday" gives away the days between.

With very few users, sometimes every number has to go. The report then shows **hidden** everywhere.

Limits, stated plainly:

- A reader can sometimes tell that a hidden count is zero, or that it is at least 1. They cannot narrow it further.
- The check covers one report. Someone who saves reports over time can see a total move by one. New-account counts use whole UTC days that have ended, so they change once a day.
- A report on a site with many small groups will be mostly hidden. Raising or lowering `minimum` changes that, and it cannot go below 2.

## Install

Nothing is published yet. When it is:

```
npm install @extantape/payload-plugin-stats
```

Needs Payload 3.80 or later, Node 22 or later, and ESM. Count bands need the MongoDB adapter; the other counts use Payload's own `count` and have only been tested on MongoDB.

```ts
import { stats } from '@extantape/payload-plugin-stats'

export default buildConfig({
  // ...
  plugins: [
    stats({
      fields: [
        { path: 'roles', label: 'Roles', groups: [{ label: 'Staff', values: ['admin', 'editor'] }] },
        { path: 'position', label: 'Positions' },
        'tenants.roles',
      ],
      bands: [{ collection: 'posts', field: 'author', thresholds: [1, 5, 10, 25, 50], label: 'Posts per user' }],
    }),
  ],
})
```

Then run `payload generate:importmap`, so the admin can find the card and the view.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `users` | `'users'` | The auth collection to count. |
| `access` | the users collection's `access.admin` | Who may see the stats: `({ req }) => boolean`. Only an exact `true` allows. Anything else, or a throw, refuses. |
| `minimum` | `5` | Counts under this never show. A whole number, 2 or more. |
| `fields` | `[]` | Fields on the users collection to count by. A path, or `{ path, label, groups, maxValues }`. |
| `bands` | `[]` | `{ collection, field, thresholds, label }`: users with more than N documents in `collection`, where `field` is a relationship to the users collection. |
| `path` | `'/stats'` | Path of the endpoint (under the API route) and of the view (under the admin route). |
| `admin` | `{ card: true, view: true }` | Set either to `false` to leave it out. |

**Fields** can be `select`, `radio` or `relationship` fields, at the top level or inside groups, tabs, rows and arrays (`tenants.roles`). `hasMany` works. A relationship is broken down by the related document's title, up to `maxValues` documents (default 50). `groups` are roll-ups for select and radio fields: users holding any of the listed values.

**Bands** are "more than N", so `1` means two or more. Use `0` for "at least one". Documents whose user has been deleted are left out.

The plugin checks all of this when Payload starts and stops the boot on a mistake. It refuses:

- a users collection with no `access.admin` when you give no `access` option, because Payload would then treat every signed-in user as an admin;
- a relationship that points at an auth collection, because a breakdown by person is a list of people;
- free-text fields, localized fields, relationships to several collections, and band fields inside arrays.

Count only by fields whose values are categories. A select option or a related document's title appears in the report as a row label.

## The endpoint

`GET /api/stats`, signed in as someone the access check allows. Logged out gets 401. Anyone else gets 403. Responses are never cached.

```json
{
  "generatedAt": "2026-11-25T18:00:00.000Z",
  "minimum": 5,
  "totals": {
    "all": { "value": 40, "text": "40" },
    "newYesterday": { "value": null, "hidden": "small", "text": "fewer than 5" },
    "new7Days": { "value": 9, "text": "9" },
    "new30Days": { "value": 20, "text": "20" }
  },
  "fields": [
    {
      "path": "roles",
      "label": "Roles",
      "multiple": true,
      "any": { "value": null, "hidden": "protected", "text": "hidden" },
      "none": { "value": null, "hidden": "small", "text": "fewer than 5" },
      "groups": [{ "label": "Staff", "count": { "value": 5, "text": "5" } }],
      "values": [{ "label": "admin", "count": { "value": null, "hidden": "small", "text": "fewer than 5" } }]
    }
  ],
  "bands": [
    { "collection": "posts", "field": "author", "label": "Posts per user", "rows": [{ "moreThan": 1, "count": { "value": 20, "text": "20" } }] }
  ]
}
```

A hidden count has `"value": null`. The real number is not in the response.

`buildReport(payload, optionsOf(payload.config))` gives the same report to server code. It does no access check, so call `allowed(options, req)` first.

## Not there yet

- The card and the view are English only.
- Checkbox fields, blocks and polymorphic relationships can't be counted by.
- Count bands on Postgres or SQLite.
- Count bands don't know about Payload's trash: a trashed document still counts toward its user.

## Develop

```
npm install
npm test
```

The tests start their own MongoDB in a throwaway Docker container on a free local port, keep its data in memory, and remove that container when the run ends. Set `STATS_TEST_MONGO_URL` to use a MongoDB you already have; the tests drop the database named in that URL.

## License

[MIT](LICENSE). Copyright (c) 2026 EXTANT APE.
