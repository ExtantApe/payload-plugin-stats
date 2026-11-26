# payload-plugin-stats

Stats for Payload: admin-only counts of users by role, position and other fields, with no names, emails or IDs, and small groups hidden.

> **Status: first version, unreleased.** 126 tests pass against a real Payload 3.92 and a real MongoDB 8: the counts, the hiding rules and every refusal. The dashboard card and the admin view have been rendered to HTML in tests and have **not been opened in a browser inside a running admin yet**. Nothing is on npm, and `package.json` stays private until the first release is planned.

## What it does

- Counts all users, and new accounts yesterday, in the last 7 days and in the last 30 days.
- Counts users by each field you name, such as roles, positions or account kinds. Each field gets a high-level table (any value, no value, and roll-ups you define) and a table with one row per value.
- Counts how many users hold more than N documents in another collection, at the thresholds you choose. For example: users with more than 1, 5, 10, 25 and 50 posts.
- Shows the result to the people your `access` function allows, in three places: a card on the dashboard, an admin view at `/admin/stats`, and a JSON endpoint at `GET /api/stats`.

A user with several values in a field is counted in each of them. An admin who also holds another role counts in both rows, so admin accounts can stay in the numbers.

## What it never does

- It never loads a user. Every read of the users collection is a count. Count bands run one grouped count inside the database and bring back a single row of totals.
- It never returns a name, an email or an ID. Responses hold labels you configured and numbers.
- It never writes. The plugin adds one `GET` endpoint and no collection.

## Small groups

No count from 1 to 4 is ever shown (with the default minimum of 5). A zero shows as **fewer than 5**.

Hiding one number is often not enough. If 40 users split into 30, 7 and a hidden 3, anyone can subtract. Hiding a second number, picked by size, is not enough either: this code is public, so which number got picked tells a careful reader about the one it protects. So the plugin hides by table. What it hides depends on how the report is laid out and never on which numbers are large:

- **A field.** When a row or a roll-up is from 1 to 4, every row and roll-up of that field shows as **hidden**. The same happens when a group nobody listed is that small: the users with a value who are outside a roll-up, or the users with some role who lack one particular role. When "any of these" or "none of these" is from 1 to 4, those two rows are hidden as well.
- **A list of steps.** New accounts (30 days, 7 days, yesterday) and count bands (more than 1, more than 5, and so on) show from the top down. At the first step that is from 1 to 4, or that sits 1 to 4 below the step before it, that step and every step under it show as **hidden**.
- **Counts that disagree.** If the data changed between two counts and the numbers no longer add up, that table is hidden.

A hidden count says nothing about its own size. It may be small or large.

**The total is always shown**, even when it is under the minimum. Anyone who can see the stats can usually read the number of users off the users list, so the plugin treats the total as public and hides everything else against a reader who knows it.

Limits, stated plainly:

- A reader can tell that a count shown as fewer than 5 is zero, and can sometimes work out that a hidden count is zero or is at least 1. They cannot narrow a count from 1 to 4 any further than the total itself allows. On a site with 3 users, every count is 3 or less.
- The check covers one report. **Someone who saves reports over time can see single changes.** The total moves by one when one account is added or removed. A row, a band or a new-account count that is showing moves by one the same way. A table that was showing and is now hidden, or the other way round, says a count in it crossed the minimum. New-account counts use whole UTC days that have ended, so they change once a day.
- A report on a site with many small groups will be mostly hidden. Roll-ups do not rescue a field with a small row. Lowering `minimum` shows more, and it cannot go below 2.

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
      // Required. Who may see the stats. Name the role yourself.
      access: ({ req }) => req.user?.collection === 'users' && req.user.roles?.includes('admin') === true,
      // Collections whose titles are categories, never people.
      categories: ['positions'],
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
| `access` | none, **required** | Who may see the stats: `({ req }) => boolean`. Only an exact `true` allows. Anything else, or a throw, refuses. |
| `categories` | `[]` | Collection slugs whose document titles are categories, such as `['positions']`. A relationship field can be counted only when it points at one of these. |
| `minimum` | `5` | Counts from 1 to one under this never show. A whole number, 2 or more. |
| `fields` | `[]` | Fields on the users collection to count by. A path, or `{ path, label, groups, maxValues }`. |
| `bands` | `[]` | `{ collection, field, thresholds, label }`: users with more than N documents in `collection`, where `field` is a relationship to the users collection. |
| `path` | `'/stats'` | Path of the endpoint (under the API route) and of the view (under the admin route). |
| `admin` | `{ card: true, view: true }` | Set either to `false` to leave it out. |

**Access is a required function, and there is no default.** The plugin refuses to start without one, and it refuses anything that is not a function (`true`, `'yes'`, `1`, `{}`, `false`, `null`). It does not fall back to the users collection's `access.admin`: in Payload that rule decides who may open the admin panel, and on many sites editors can. Write the check for the people who should see the numbers. If the site has more than one auth collection, check `req.user.collection` too, as the example does. A signed-out request is always refused before your function runs.

**Fields** can be `select`, `radio` or `relationship` fields, at the top level or inside groups, tabs, rows and arrays (`tenants.roles`). `hasMany` works. `groups` are roll-ups for select and radio fields: users holding any of the listed values.

**A relationship field needs its collection listed in `categories`.** A relationship is broken down by the related document's title, up to `maxValues` documents (default 50), and every title shows as a row label even when its count is hidden. The titles are read past access control. A collection with one document per person, such as profiles titled by full name, would put names in the report, and only you know which collections are like that. So nothing is counted by relationship until you name the collection.

**Bands** are "more than N", so `1` means two or more. Use `0` for "at least one". Documents whose user has been deleted are left out.

The plugin checks all of this when Payload starts and stops the boot on a mistake. It refuses:

- a missing `access`, or one that is not a function;
- a relationship field whose collection is not in `categories`;
- a relationship that points at an auth collection, listed or not, because a breakdown by person is a list of people;
- a counted field, a band field, or any group, array or tab on the path to one, that has its own `access.read`. A count would show what that rule hides. The same goes for the title field of a `categories` collection;
- free-text fields, localized fields, relationships to several collections, and band fields inside arrays.

Count only by fields whose values are categories. A select option or a related document's title appears in the report as a row label.

## The endpoint

`GET /api/stats`, signed in as someone the `access` function allows. Logged out gets 401. Anyone else gets 403. Responses are never cached.

```json
{
  "generatedAt": "2026-11-25T18:00:00.000Z",
  "minimum": 5,
  "totals": {
    "all": { "value": 40, "text": "40" },
    "newYesterday": { "value": null, "hidden": "protected", "text": "hidden" },
    "new7Days": { "value": 9, "text": "9" },
    "new30Days": { "value": 20, "text": "20" }
  },
  "fields": [
    {
      "path": "roles",
      "label": "Roles",
      "multiple": true,
      "any": { "value": 40, "text": "40" },
      "none": { "value": null, "hidden": "small", "text": "fewer than 5" },
      "groups": [{ "label": "Staff", "count": { "value": null, "hidden": "protected", "text": "hidden" } }],
      "values": [{ "label": "admin", "count": { "value": null, "hidden": "protected", "text": "hidden" } }]
    }
  ],
  "bands": [
    { "collection": "posts", "field": "author", "label": "Posts per user", "rows": [{ "moreThan": 1, "count": { "value": 20, "text": "20" } }] }
  ]
}
```

A hidden count has `"value": null`. The real number is not in the response. `"hidden": "small"` is a zero. `"hidden": "protected"` is a count hidden with its table, and it may be any size.

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

The tests start their own MongoDB in a throwaway Docker container on a free local port, keep its data in memory, and remove that container when the run ends, including when the run is stopped with Ctrl-C or killed. Set `STATS_TEST_MONGO_URL` to use a MongoDB you already have; the tests drop the database named in that URL.

## License

[MIT](LICENSE). Copyright (c) 2026 EXTANT APE.
