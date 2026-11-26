# Deploy and publish

Step-by-step instructions to put market-chart online: the **source on GitHub**, the **packages on npm** and the
**documentation site** on a static host. Follow the parts in order the first time; for later releases only
[part 6](#6-later-releases) is needed.

| Part | What | When |
|---|---|---|
| [1](#1-accounts-and-tools) | Accounts and tools | once |
| [2](#2-prepare-the-repository) | Prepare the repository | once (some steps after big changes) |
| [3](#3-put-the-source-on-github) | Source on GitHub | once |
| [4](#4-first-npm-release) | First npm release (from your computer) | once |
| [5](#5-check-the-published-packages) | Check the published packages in a new project | every release |
| [6](#6-later-releases) | Later releases with Changesets | every release |
| [7](#7-automated-releases-optional) | CI and automated releases with npm provenance | optional, recommended |
| [8](#8-deploy-the-documentation-site) | Documentation site | after each release |
| [9](#9-optional-deploy-the-playground-and-the-nextjs-example) | Playground and Next.js example | optional |
| [10](#10-fixing-mistakes) | Fixing mistakes | when needed |

What gets published to npm (all public, MIT, version `0.1.0` today):

| Package | Folder |
|---|---|
| `@market-chart/core` | `packages/core` |
| `@market-chart/react` | `packages/react` |
| `@market-chart/indicators` | `packages/indicators` |
| `@market-chart/drawing-tools` | `packages/drawing-tools` |
| `@market-chart/charts` | `packages/charts` |
| `@market-chart/datafeed` | `packages/datafeed` |
| `@market-chart/persistence` | `packages/persistence` |
| `@market-chart/i18n` | `packages/i18n` |
| `@market-chart/ui` | `packages/ui` |
| `@market-chart/trading` | `packages/trading` |
| `@market-chart/testing` | `packages/testing` |

`apps/docs`, `apps/playground` and `apps/nextjs` are private: they are never published to npm (they are
`"private": true` and ignored in `.changeset/config.json`).

> `@market-chart/trading` and every example show orders and positions only. The library never trades. Keep the
> "simulated" wording in demos you publish.

---

## 1. Accounts and tools

1. **Node.js 20 or newer** and **pnpm 10** (pinned in `package.json`):

   ```powershell
   corepack enable
   ```

   ```powershell
   pnpm --version
   ```

2. **npm account** at <https://www.npmjs.com/signup>. Turn on two-factor authentication (Account → *Two-Factor
   Authentication*, "Authorization and writes").

3. **npm organisation for the scope.** Every package is named `@market-chart/…`, so you need to own the
   `market-chart` scope: npmjs.com → your avatar → *Add organization* → name `market-chart`, plan *Unlimited
   public packages* (free). Check that the names are free:

   ```powershell
   npm view @market-chart/core
   ```

   `404 Not Found` means free. If the organisation name is taken, choose another scope (for example
   `@yourname-chart`) and replace `@market-chart/` everywhere: package names, imports, Vite and Vitest aliases,
   `tsconfig` paths and the documentation.

4. **GitHub account**, with two-factor authentication. The GitHub CLI is optional but saves steps:

   ```powershell
   winget install GitHub.cli
   ```

5. **A static host for the documentation** (part 8): Cloudflare Pages or Netlify (both apply the security
   headers in `apps/docs/public/_headers`), or GitHub Pages (simpler, but it ignores `_headers`).

## 2. Prepare the repository

### 2.1 Install and link the workspace

Install the dependencies and link the workspace packages to each other (needed after adding a package; a package
without links fails `pnpm build` at its type declarations):

```powershell
pnpm install
```

If this changes `pnpm-lock.yaml`, commit it with the rest (part 3). CI uses `--frozen-lockfile`, so the committed
lockfile must match `package.json`.

### 2.2 Peer dependency ranges (do this before the first publish)

Several packages declare sibling packages as **peer** dependencies with `workspace:*`. On publish, pnpm turns
`workspace:*` into the **exact** version (`"@market-chart/react": "0.1.0"`), so users could not combine
`@market-chart/ui@0.1.0` with `@market-chart/react@0.1.1`, and Changesets would bump every dependent package
whenever a peer changes. Use `workspace:^` for peer dependencies (published as `^0.1.0`) and keep
`workspace:*` for normal dependencies.

Files and fields to change (`peerDependencies` only):

| File | Peer dependencies to change to `workspace:^` |
|---|---|
| `packages/datafeed/package.json` | `@market-chart/react` |
| `packages/drawing-tools/package.json` | `@market-chart/react` |
| `packages/indicators/package.json` | `@market-chart/react` |
| `packages/persistence/package.json` | `@market-chart/react` |
| `packages/ui/package.json` | `@market-chart/drawing-tools`, `@market-chart/indicators`, `@market-chart/react` |
| `packages/trading/package.json` | `@market-chart/i18n`, `@market-chart/react`, `@market-chart/ui` |

Then release all packages with one shared version, so the ranges always line up. In `.changeset/config.json`
set:

```json
"fixed": [["@market-chart/*"]]
```

With a fixed group, a change to any package bumps all of them to the same new version. (On `0.x` versions a
caret range only covers the same minor version, `^0.1.0` = `>=0.1.0 <0.2.0`, which is exactly what a shared
version needs.)

Run `pnpm install` once more after editing `package.json` files.

### 2.3 Package metadata

npm shows these fields on each package page, and npm provenance (part 7) requires `repository`. They are
already set in every `packages/*/package.json` for <https://github.com/SinaMohammadi/market-chart>, with each
package's folder in `directory` and `homepage`:

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/SinaMohammadi/market-chart.git",
  "directory": "packages/core"
},
"homepage": "https://github.com/SinaMohammadi/market-chart/tree/main/packages/core#readme",
"bugs": { "url": "https://github.com/SinaMohammadi/market-chart/issues" },
"keywords": ["chart", "charting", "financial-chart", "candlestick", "trading-chart", "canvas", "typescript"]
```

If the repository moves, update these three URLs in all 11 files. Optionally add `"author": "Your Name"`.

### 2.4 License holder

`LICENSE` (in the root and in every package) says *market-chart contributors*. Replace it with your name or
organisation if you prefer; keep the MIT text.

### 2.5 Tooling updates (recommended)

The security review found advisories in development tools only (Vitest, esbuild through tsup); nothing that is
published depends on them. Update them, then check:

```powershell
pnpm up -D vitest@latest tsup@latest
```

```powershell
pnpm audit --prod
```

`--prod` must report no vulnerabilities. Vitest 4 is a major update: it removed `poolOptions`, which
`vitest.bench.config.ts` uses (`singleFork` and the `--expose-gc` arguments). Follow the Vitest migration
guide for those options, then run the tests and benchmarks (2.6) before going on. If you prefer to release
first, skip this step: it changes only development tools.

### 2.6 Full check

Everything must pass before a release:

```powershell
pnpm build
```

```powershell
pnpm typecheck
```

```powershell
pnpm test
```

```powershell
pnpm lint
```

```powershell
pnpm bench
```

```powershell
pnpm docs:build
```

`pnpm format:check` also reports files that were never formatted (some READMEs and `tsconfig.test.json`
files). Format them once and commit the result:

```powershell
pnpm format
```

The real-Chromium suites (`*.browser.test.*`) skip themselves under jsdom; they run in a browser harness that
is not part of `pnpm test` yet (planned together with the CI workflows).

## 3. Put the source on GitHub

1. Create the repository and the first commit:

   ```powershell
   git init -b main
   ```

   ```powershell
   git add .
   ```

   ```powershell
   git status
   ```

   Read the list. It must not contain `node_modules`, `dist`, `.env` files, `.npmrc`, keys or `.claude/`
   (`.gitignore` excludes them, and `tests/repo/publishing.test.ts` scans for secrets and local paths).

   ```powershell
   git commit -m "Initial release of market-chart"
   ```

2. Create an **empty public** repository named `market-chart` on GitHub (no README, license or `.gitignore`:
   they exist already) and push:

   ```powershell
   gh repo create market-chart --public --source . --push
   ```

   Without the GitHub CLI: create the repository on github.com, then

   ```powershell
   git remote add origin https://github.com/SinaMohammadi/market-chart.git
   ```

   ```powershell
   git push -u origin main
   ```

3. Repository settings on GitHub:
   - *Settings → Code security*: turn on **Private vulnerability reporting** (`SECURITY.md` points to it),
     Dependabot alerts and secret scanning.
   - *Settings → Branches*: protect `main` (require pull requests and, once part 7 is set up, the CI check).
   - *About* (gear on the repository page): description, website (the docs URL from part 8), topics.

## 4. First npm release

The packages are already at `0.1.0`, so the first release needs no changeset: publish what is in the
repository.

1. Log in (with your two-factor code) and check the account:

   ```powershell
   npm login
   ```

   ```powershell
   npm whoami
   ```

2. Dry run. This builds everything and lists, for every package, the files that would be uploaded:

   ```powershell
   pnpm release:check
   ```

   Check each package's list: only `dist/…`, `README.md`, `LICENSE` and `package.json`.

   The dry run does not show the `package.json` that npm receives (pnpm rewrites `workspace:` ranges while
   packing). Look at one package's real tarball, for example the one with the most peer dependencies:

   ```powershell
   cd packages/trading
   ```

   ```powershell
   pnpm pack
   ```

   ```powershell
   tar -xOzf market-chart-trading-0.1.0.tgz package/package.json
   ```

   No `workspace:` may be left, and the `@market-chart/*` peer ranges must be `^0.1.0` (part 2.2). Then
   delete the `.tgz` (`*.tgz` is ignored by git) and go back:

   ```powershell
   Remove-Item market-chart-trading-0.1.0.tgz; cd ../..
   ```

3. Publish every package whose version is not on npm yet:

   ```powershell
   pnpm release
   ```

   npm asks for a one-time password when two-factor authentication is on. Changesets publishes in dependency
   order and creates a git tag per package (`@market-chart/core@0.1.0` …).

4. Push the tags:

   ```powershell
   git push --follow-tags
   ```

5. Create a GitHub release for the tag of `@market-chart/core@0.1.0` (*Releases → Draft a new release*), with
   a short summary and a link to the documentation.

## 5. Check the published packages

Install the published packages in a new, separate project, the way a user would. Do this after every
release:

```powershell
cd $env:TEMP
```

```powershell
pnpm create vite market-chart-check --template react-ts
```

```powershell
cd market-chart-check
```

```powershell
pnpm add @market-chart/core @market-chart/react @market-chart/ui @market-chart/i18n @market-chart/persistence @market-chart/indicators @market-chart/drawing-tools @market-chart/trading @market-chart/testing
```

Replace `src/App.tsx` with:

```tsx
import { useState } from 'react';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { generateBars, HOUR } from '@market-chart/testing';
import { TradingOverlay } from '@market-chart/trading/react';
import { ChartInterface, useChartUi } from '@market-chart/ui/react';

const bars = generateBars({ count: 300, interval: HOUR, seed: 1, startPrice: 100 }); // synthetic

export default function App() {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const ui = useChartUi(chart);
  const last = bars[bars.length - 1]!.close;
  return (
    <ChartInterface ui={ui} height={520}>
      <Chart ref={setChart} height="100%">
        <CandlestickSeries data={bars} />
        {ui ? (
          <TradingOverlay
            ui={ui}
            orders={[{ id: 'demo', side: 'buy', type: 'limit', price: last * 0.98, quantity: 1 }]}
          />
        ) : null}
      </Chart>
    </ChartInterface>
  );
}
```

```powershell
pnpm dev
```

Open the printed address: the chart, header, sidebar and a "BUY LMT" line must appear, with no errors in the
browser console. Then check the production build and the types:

```powershell
pnpm build
```

```powershell
pnpm exec tsc --noEmit -p tsconfig.app.json
```

Delete the folder afterwards.

## 6. Later releases

For every change you want to release:

1. Describe the change (on a branch, in the same pull request as the code):

   ```powershell
   pnpm changeset
   ```

   Pick the packages, the bump (`patch` for fixes, `minor` for features; on `0.x`, `minor` may also contain
   breaking changes) and write one or two sentences for the changelog. A file appears in `.changeset/`;
   commit it.

2. When you are ready to release (on `main`, everything merged):

   ```powershell
   pnpm changeset version
   ```

   This bumps versions (all packages together with the fixed group from 2.2), updates internal ranges and
   writes each `CHANGELOG.md`. Review the diff.

3. Check, commit, publish, push:

   ```powershell
   pnpm build; pnpm typecheck; pnpm test; pnpm lint
   ```

   ```powershell
   pnpm release:check
   ```

   ```powershell
   git add .; git commit -m "Release"
   ```

   ```powershell
   pnpm release
   ```

   ```powershell
   git push --follow-tags
   ```

4. Update `FEATURE_MATRIX.md` if the status of a feature changed, create the GitHub release, check the packages
   (part 5) and redeploy the documentation (part 8).

## 7. Automated releases (optional)

Publishing from GitHub Actions adds **npm provenance** (the package page shows which commit and workflow built
it) and removes manual steps. Create these two files and commit them.

### 7.1 Continuous integration: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm docs:build
```

`pnpm/action-setup` reads the pnpm version from `packageManager` in `package.json`.

### 7.2 Release: `.github/workflows/release.yml`

On every push to `main`, this opens (or updates) a "Version packages" pull request from the changesets; when
you merge that pull request, it publishes to npm with provenance.

```yaml
name: Release
on:
  push:
    branches: [main]
concurrency: ${{ github.workflow }}-${{ github.ref }}
permissions:
  contents: write
  pull-requests: write
  id-token: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm build && pnpm test
      - uses: changesets/action@v1
        with:
          version: pnpm changeset version
          publish: pnpm release
          title: Version packages
          commit: Version packages
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: 'true'
```

Setup:

1. npmjs.com → *Access Tokens* → *Generate New Token* → **Granular Access Token**: packages and scopes →
   *Read and write* for `@market-chart`; organisation `market-chart`; an expiry date. Copy the token (it is
   shown once).
2. GitHub → repository → *Settings → Secrets and variables → Actions* → *New repository secret*: name
   `NPM_TOKEN`, value the token. Never put the token in a file in the repository.
3. GitHub → *Settings → Actions → General* → *Workflow permissions*: allow GitHub Actions to create pull
   requests.
4. Provenance needs the `repository` field from 2.3 to match the GitHub repository.

npm also supports **trusted publishing** (no token: npm trusts this repository's workflow). If you set it up
for each package on npmjs.com (*Settings → Trusted publishing*), remove `NPM_TOKEN` and `NODE_AUTH_TOKEN`
from the workflow.

From then on, a release is: add changesets in your pull requests, merge them, then merge the "Version
packages" pull request.

## 8. Deploy the documentation site

`pnpm docs:build` writes a static site to `apps/docs/dist`. It uses hash routes and relative paths, so it
works from any folder and needs no server rules. It reads the repository's Markdown files, so redeploy after
each release.

### Option A: Cloudflare Pages or Netlify (recommended: applies the security headers)

Both read `apps/docs/public/_headers` (Content-Security-Policy, HSTS, frame and referrer policies).

Cloudflare Pages: *Workers & Pages → Create → Pages → Connect to Git*, pick the repository, then

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm docs:build` |
| Build output directory | `apps/docs/dist` |
| Environment variable | `NODE_VERSION` = `22` |

Netlify: *Add new site → Import an existing project*, pick the repository, then

| Setting | Value |
|---|---|
| Base directory | (empty) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm docs:build` |
| Publish directory | `apps/docs/dist` |
| Environment variable | `NODE_VERSION` = `22` |

Each push to `main` then redeploys the site. To deploy by hand instead, build locally and upload
`apps/docs/dist` (Netlify: drag the folder onto *Sites → Deploy manually*; Cloudflare: `pnpm dlx wrangler
pages deploy apps/docs/dist`).

### Option B: GitHub Pages

GitHub Pages ignores `_headers`; the page still carries its baseline Content-Security-Policy `<meta>` tag
(`apps/docs/index.html`). Create `.github/workflows/docs.yml`:

```yaml
name: Docs
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: pages
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm docs:build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: apps/docs/dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then GitHub → *Settings → Pages → Source*: **GitHub Actions**. The site appears at
`https://sinamohammadi.github.io/market-chart/`.

### Check the deployed site

Open the site and go through *Live examples*, *Chart builder* and *Reference → Symbols, price actions and
trading objects*. Open the browser's developer tools: the console must show no errors (in particular no
Content-Security-Policy violations), and every example must render. On Cloudflare Pages or Netlify, the
*Network* tab shows the headers from `_headers` on the document response.

## 9. Optional: deploy the playground and the Next.js example

**Playground** (a static Vite app, like the docs):

| Setting | Value |
|---|---|
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter playground build` |
| Output directory | `apps/playground/dist` |

**Next.js example** on Vercel: *Add New → Project*, import the repository, then

| Setting | Value |
|---|---|
| Root directory | `apps/nextjs` |
| Install command | `cd ../.. && corepack enable && pnpm install --frozen-lockfile` |
| Build command | `cd ../.. && pnpm build && pnpm --filter nextjs-example build` |

The example uses the built packages (`dist/`), so the packages are built first. Its security headers are set
in `apps/nextjs/next.config.mjs`.

## 10. Fixing mistakes

- **A published version cannot be changed or reused.** Fix it with a new version (`pnpm changeset`, a patch).
- **Mark a broken version** so installs warn:

  ```powershell
  npm deprecate @market-chart/core@0.1.1 "Broken build, use 0.1.2"
  ```

- **Unpublish** is only possible within 72 hours and only if no other package depends on it; prefer
  deprecating.
- **Leaked token**: revoke it on npmjs.com (*Access Tokens*) and on GitHub at once, then create a new one.

### Common errors

| Error | Cause and fix |
|---|---|
| `pnpm build` fails in `@market-chart/trading` with "Cannot find module '@market-chart/core'" | Workspace links missing: run `pnpm install` (2.1) |
| `E404` / `E403` on publish for `@market-chart/…` | You are not logged in (`npm whoami`), not a member of the `market-chart` organisation, or the scope belongs to someone else (1.3) |
| `EOTP` | Two-factor code needed: run `pnpm release` again and enter the code |
| `You cannot publish over the previously published versions` | That version is already on npm: bump it with a changeset |
| Published `package.json` contains `workspace:` | It was published with `npm publish` inside a package folder. Always use `pnpm release` (or `pnpm publish`), which rewrites workspace ranges |
| Users cannot install `@market-chart/ui` next to a newer `@market-chart/react` | Exact peer ranges: do 2.2 and release a new version |
| Provenance error in CI | `id-token: write` missing, or the `repository` field does not match the GitHub repository (2.3) |
| Docs site shows a blank page | Open the console. A CSP violation on a custom host means its header policy is stricter than `_headers`; copy the policy from `_headers` |
