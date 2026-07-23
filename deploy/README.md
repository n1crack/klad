# Deploying the documentation

The site at [klad.ozdemir.be](https://klad.ozdemir.be) is static, built on the
server by Laravel Forge's own zero-downtime deployment: Forge pulls `main`,
runs [`forge-deploy.sh`](forge-deploy.sh), and points `current` at the new
release once it succeeds. nginx then serves files and nothing else.

| | |
|---|---|
| [`forge-deploy.sh`](forge-deploy.sh) | The deploy script, to paste into Forge. |
| [`nginx.conf`](nginx.conf) | The site's rules, to paste into Forge's config. |

## Server setup, once

1. **DNS** — an `A` record for `klad` pointing at the server.
2. **Forge → New Site** for `klad.ozdemir.be`, project type **Static HTML**,
   **Web Directory** left at Forge's default `/public`. VitePress writes to
   `packages/docs/.vitepress/dist`; the last step of the deploy script moves it
   to `public/`, so the site setting is the same as every other site here.
3. **Install Repository**: `n1crack/klad`, branch `main`, **Quick Deploy on**.
   That is what makes a merge to `main` a deploy.
4. **Deploy Script**: paste [`forge-deploy.sh`](forge-deploy.sh).
5. **Node**: the build needs **Node 22.12 or newer** (`engines.node` in the
   root manifest). Forge's server settings can install it; `node -v` over SSH
   is the check.
6. **SSL** — Let's Encrypt, from the site's SSL tab.
7. **Nginx** — paste [`nginx.conf`](nginx.conf) into the generated `server`
   block, keeping Forge's own `listen`, `server_name`, `root` and SSL lines,
   and dropping the PHP location block. The `try_files $uri $uri.html` rule is
   the one that matters: VitePress builds `cleanUrls`, so links carry no
   extension while the files on disk do, and without it every page except the
   home page 404s.

## Checking a build the way the server runs it

```bash
DOCS_BASE=/ DOCS_URL=https://klad.ozdemir.be pnpm --filter @klad/docs build
pnpm --filter @klad/docs preview
```

## If it should ever build in CI instead

Building on the server means the server needs Node and pnpm, and that what is
live is whatever the server produced rather than exactly what CI saw. The
alternative is a workflow that builds and rsyncs the output over SSH — worth
the swap the day the toolchain on the box drifts from the one in CI, and a
small change either way.
