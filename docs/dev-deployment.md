# Cloudflare development deployment

The `dev` environment deploys the full app to its own Worker, D1 database,
and R2 bucket in the configured Cloudflare account.

| Resource    | Development             | Production       |
| ----------- | ----------------------- | ---------------- |
| Worker      | `mellowart-dev`         | `mellow-cf`      |
| D1 database | `mellowart-dev-db`      | `mellow-db`      |
| R2 bucket   | `mellowart-dev-uploads` | `mellow-uploads` |

## Deploy development

```bash
bun run db:migrate:dev
bun run deploy:dev
```

The Cloudflare Vite plugin selects the environment **during the build**.
`build:dev` sets `CLOUDFLARE_ENV=dev`, and Wrangler deploys the generated
configuration. Do not add `--env dev` to the deployment command after building.

`bun run deploy` runs the production release, including a database backup and
pending migrations. Use `bun run deploy:dev` for development. The bindings in
the top-level Wrangler configuration retain the production resources.

## Initial data copy

On 2026-10-01, production data was copied into the empty development database:
481 submissions, 773 image records, 126 invoices, 2 events, 7 stall options,
2 administrator accounts, 1,001 activity records, and the global email settings.
Administrator accounts retain their existing passwords. The development
database also has migrations through `0020` applied.

The Gmail and Xero OAuth token tables are empty in development. Connect these
services separately through Invoice settings if needed. The app's JWT signing
secret and public-form client key were generated specifically for development.
The configured Google client credentials from local `.dev.vars` were installed
as development Worker secrets. Xero client credentials were absent locally;
configure `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` on the dev Worker before
connecting Xero.

Register these callback URLs with the relevant OAuth app before connecting:

```text
https://mellowart-dev.mellowartmarket.workers.dev/google/callback
https://mellowart-dev.mellowartmarket.workers.dev/xero/callback
```

All 975 R2 files (2,289,568,316 bytes) were copied with their original keys and
metadata. The source and destination inventories were verified by key, size,
and ETag, so the migrated submission records can use the development bucket
independently.
Further development changes do not synchronize back to production.

The migration exports and generated secret file are kept locally under
`.wrangler/`, which is ignored by Git. Do not commit them.
