# Monitor

Open-source QJAI delivery monitoring Worker, migrated from a private codebase into a new, clean Git history.

## Features

- Five read-only delivery checks: Product Hunt, overseas collection, overseas production, X intelligence, and TrustMRR weekly.
- Self-hosted n8n schedules; no Cloudflare Cron, automatic recovery, or historical event database.
- Notion READY and GitHub Actions success checks with Feishu alerts only on failures.
- Private console with PBKDF2 password authentication and 12-hour HttpOnly sessions in PostgreSQL through Cloudflare Hyperdrive.
- No production keys, database URLs, Cloudflare account IDs, or private Notion page IDs in this repository.

## Architecture

```text
n8n schedule -> POST https://ingest.monitor.qjai.org/v1/checks/<check>
                    -> Notion/GitHub read-only -> Feishu on failure

https://monitor.qjai.org -> Login -> Hyperdrive/PostgreSQL sessions
                         -> Dashboard -> five read-only checks
```

The runtime currently targets the QJAI Monitor hostnames. To self-host, change the hostnames and your own source mappings before deploying.

## Configuration

Set the following **only in deployment secrets / local ignored config**, never commit values:

| Binding | Purpose |
| --- | --- |
| `OPS_SCHEDULER_TOKEN` | n8n-to-Worker Bearer credential (at least 32 chars) |
| `OPS_NOTION_READ_TOKEN` | Read-only Notion integration token |
| `GITHUB_READ_TOKEN` | GitHub Actions read token |
| `FEISHU_WEBHOOK_URL` | Feishu bot alert webhook |
| `OPS_PRODUCTHUNT_NOTION_PARENT_ID` | Parent Notion page for Product Hunt |
| `OPS_X_NOTION_PARENT_ID` | Parent Notion page for X intelligence |
| `OPS_TRUSTMRR_NOTION_PARENT_ID` | Parent Notion page for TrustMRR |
| `HYPERDRIVE` | Production Hyperdrive binding to PostgreSQL |

The committed `wrangler.jsonc` is intentionally a non-production template. The QJAI production Worker retains its existing internal service name so its protected Secrets and Hyperdrive connection can be reused; this internal name does not affect the new public GitHub repository or hostnames. Configure your own account, Hyperdrive ID, hosts, and secrets through private Cloudflare configuration. Do not deploy a template over an existing production Worker without reviewing bindings.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run ci
npx wrangler@4 deploy --dry-run --outdir=dist --minify --strict
```

CI only validates and bundles. No workflow in this repository deploys production or accesses credentials.

## Operational principles

- Successful checks send no message. Failed checks notify via Feishu; no automatic remediation.
- The console only checks on first load and manual refresh, with no repeated polling.
- n8n Workflows must use header credentials stored within n8n. Five sanitized templates are included in `n8n/workflows`.
- The open-source code is a **clean snapshot**; no commits, PRs, deployment incidents, or private runbooks from the previous repository are imported.

## License

MIT.
