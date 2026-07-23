# Deploying the documentation

The site at [klad.ozdemir.be](https://klad.ozdemir.be) is static: GitHub
Actions builds it on every merge to `main` and rsyncs the result to a Laravel
Forge server, which only serves files. Nothing about the build lives on the
server — no Node, no pnpm, no checkout — so what is live is exactly what a
green CI produced, and rebuilding the box is a matter of pointing nginx at a
directory again.

## What is where

| | |
|---|---|
| [`../.github/workflows/docs.yml`](../.github/workflows/docs.yml) | Builds and deploys. |
| [`nginx.conf`](nginx.conf) | The site's rules, to paste into Forge's own config. |

## Server setup, once

1. **DNS** — an `A` record for `klad` pointing at the server.
2. **Forge → New Site** for `klad.ozdemir.be`, project type **Static HTML**.
   No git repository: the deploy comes from CI, not from the server pulling.
3. **SSL** — Let's Encrypt, from the site's SSL tab.
4. **Nginx** — replace the generated `server` block's body with
   [`nginx.conf`](nginx.conf), keeping Forge's own `listen`, `server_name`,
   `root` and SSL lines. The `try_files $uri $uri.html` rule is the one that
   matters: VitePress builds `cleanUrls`, so every page but the home page
   404s without it.
5. **A key for CI** — generate a keypair *for this deploy only*:

   ```bash
   ssh-keygen -t ed25519 -C 'klad docs deploy' -f klad-docs -N ''
   ```

   Put `klad-docs.pub` in the site user's `~/.ssh/authorized_keys` on the
   server, and `klad-docs` (the private half) in the repository's secrets.
   Then delete both local copies — the only two places it needs to exist are
   the server and GitHub.

## Repository secrets

| Secret | Example |
|---|---|
| `FORGE_HOST` | the server's IP or hostname |
| `FORGE_USER` | `forge` |
| `FORGE_PATH` | `/home/forge/klad.ozdemir.be` |
| `FORGE_SSH_KEY` | the private key generated above, whole file including both `-----` lines |

## Deploying by hand

Merging to `main` is the deploy. To run it without a merge — after changing
nginx, say — use **Actions → Docs → Run workflow**.

To check what would go out, build it locally the way CI does:

```bash
DOCS_BASE=/ DOCS_URL=https://klad.ozdemir.be pnpm --filter @klad/docs build
pnpm --filter @klad/docs preview
```
