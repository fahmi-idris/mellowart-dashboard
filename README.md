# Mellow Art Dashboard

Full-stack administration system for Mellow Art Market artist applications.
The public application form lives in Webflow; this project receives those
submissions, stores their data and documents in Cloudflare, and provides the
admin workflow for reviewing applications, assigning stalls, creating Xero
invoices, and sending email through Gmail.

## Technology

- Bun for dependency management and project scripts
- React 19 and React Router 7 with server-side rendering
- TypeScript, Vite, Tailwind CSS, and shadcn/Radix components
- Cloudflare Workers for the application runtime
- Cloudflare D1 for relational data
- Cloudflare R2 for portfolio and insurance documents
- Xero OAuth/API for invoices
- Google OAuth and the Gmail API for transactional email
- Vitest for automated tests

This is one full-stack Worker application. There is no separately deployed
frontend or backend service.

## Local development

### Prerequisites

- [Bun](https://bun.sh/) installed
- Node.js 22.13+ (release scripts and SQLite-backed tests)
- Git

Cloudflare login is not required for ordinary local development. The
Cloudflare Vite plugin provides local Worker, D1, and R2 environments.

### 1. Install dependencies

```bash
bun install
```

### 2. Configure local secrets

```bash
cp .dev.vars.example .dev.vars
```

Generate two development-only random values:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Add them to `.dev.vars`:

```dotenv
JWT_SECRET="<first generated value>"
CLIENT_KEY="<second generated value>"

XERO_CLIENT_ID=""
XERO_CLIENT_SECRET=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

The Xero and Google values may remain empty while working on the core
dashboard. Invoice creation and email sending require real OAuth credentials.

Never commit `.dev.vars`; it is ignored by Git.

### 3. Create and seed the local database

```bash
bun run db:migrate:local
bun run db:seed:local
```

### 4. Create a local admin

```bash
ADMIN_EMAIL="admin@example.com" \
ADMIN_PASSWORD="choose-a-strong-password" \
bun run db:admin:local
```

### 5. Start the full-stack application

```bash
bun run dev
```

Open [http://localhost:5173/login](http://localhost:5173/login) and sign in with
the local admin account. Local D1 and R2 data is kept under `.wrangler/` and is
separate from production.

## Common commands

| Command                                  | Purpose                                                   |
| ---------------------------------------- | --------------------------------------------------------- |
| `bun run dev`                            | Start the local full-stack server with HMR                |
| `bun run test`                           | Run the Vitest suite once                                 |
| `bun run typecheck`                      | Generate Cloudflare/route types and run TypeScript checks |
| `bun run format`                         | Format supported project files with Prettier              |
| `bun run build`                          | Create a production build                                 |
| `bun run preview`                        | Build and preview the production output locally           |
| `bun run db:migrate:local`               | Apply pending D1 migrations locally                       |
| `bun run db:seed:local`                  | Add local example events, stalls, and submissions         |
| `bun run db:admin:local`                 | Create a local administrator                              |
| `bun run db:query:local -- "SELECT ..."` | Execute a SQL query against local D1                      |
| `bun run db:reset:local`                 | Delete and recreate local D1 data                         |

`db:reset:local` is destructive, but only for the local D1 state under
`.wrangler/`.

## Editor formatting

The repository uses Prettier and enables format-on-save through the committed
VS Code workspace settings. When VS Code recommends the **Prettier - Code
formatter** extension, install it and reload the workspace. Other editors should
use the repository's `.prettierrc.json`, or formatting can be run manually with
`bun run format`.

## Architecture at a glance

```text
Webflow form
    -> POST /api/submit
    -> Cloudflare Worker
       -> D1: application and workflow records
       -> R2: portfolio and insurance documents
       -> Gmail API: confirmation email

Admin browser
    -> React Router loaders/actions and same-origin JSON APIs
    -> Cloudflare Worker
       -> D1 / R2
       -> Xero API / Gmail API
```

Webflow is currently the public form, not the application database. Artist
submissions flow from Webflow into D1/R2. Automatic synchronization of Webflow
CMS event records is not implemented; events are currently managed in the
dashboard or seeded locally.

Read [System architecture and development guide](docs/architecture.md) for the
request flows, database model, project structure, Cloudflare infrastructure,
and the recommended workflow for enhancements.

Additional references:

- [Public event catalog API](docs/events-api.md)
- [Artist application API](docs/api-submit.md)
- [Infrastructure provisioning record](docs/infra-provisioning.md)
- [Admin user manual](docs/manual.md)
- [Webflow embed reference](docs/webflow-embed.txt)

## Production deployment

For the isolated `mellowart-dev` Worker and a copy of the production data, use
`bun run deploy:dev`. See [Development deployment](docs/dev-deployment.md) for
the separate database/storage bindings and migration commands.

Production deployment requires access to the configured Cloudflare account.
After pushing your code, run the production release script:

```bash
bun run deploy:production
```

The script checks types, runs tests, builds and validates the production target,
exports a database backup, applies pending migrations, checks foreign-key
integrity, and deploys the Worker. Any failed step stops the release.
`bun run deploy` is an alias for the same production release.

Backups are kept in dated, private folders under `.wrangler/releases/` and are
ignored by Git. In CI, preserve that folder as a private artifact before the
runner is removed. Already-applied migrations are skipped; keep migration files
in Git and add new files for future schema changes.

To validate the release locally without changing production:

```bash
bun run deploy:production:check
```

`db:migrations:production` lists pending migrations, and `db:migrate:production`
applies them independently when needed. The full release script handles both
steps automatically. Git push alone does not run this script; a production CI
pipeline can use `bun run deploy:production` as its deployment command.

## Security warning

The current historical infrastructure and Webflow integration documents contain
credentials that have been exposed to source control or browser code. Treat
those credentials as compromised, rotate them, and do not use a static browser
`CLIENT_KEY` as the long-term protection for the public submission endpoint.
See the security section in the architecture guide.
