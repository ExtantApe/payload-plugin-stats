# Releasing

One description everywhere: `package.json` (`description`, `keywords`) is the source; GitHub's description and topics are synced from it before each release, npm takes it at release, and the Release workflow refuses to stage if GitHub differs.

One process for every EXTANT APE package:

1. Bump `version` in `package.json` (and the changelog, if any), commit as `Release x.y.z`, tag `vx.y.z`, and push the commit and the tag.
2. The Release workflow builds, tests and **stages** the version on npm (trusted publishing, no stored token).
3. The npm account that owns the `extantape` org approves it with 2FA: npmjs.com → avatar → **Staged Packages** → **Approve**, or `npm stage list` then `npm stage approve <id>`. Only then is it public.

The very first version of a new package is published by hand (`npm publish --access public`), because npm can only trust a workflow for a package that exists; then run once:

```bash
npm trust github @extantape/payload-plugin-stats --repo ExtantApe/payload-plugin-stats --file release.yml --allow-stage-publish --yes
```

Until that first hand publish, a `v*` tag stages nothing: the Release workflow sees the package isn't on npm yet, says so, and stops cleanly.

The tests need MongoDB. Locally they start a throwaway Docker container and remove it when the run ends; in CI and the Release workflow a service container is used through `STATS_TEST_MONGO_URL`.
