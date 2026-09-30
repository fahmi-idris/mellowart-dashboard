# Mellow Art System Architecture and Development Guide

This document is the technical onboarding guide for the Mellow Art Dashboard.
It describes the system that exists in this repository today, including places
where older comments or documents describe functionality that is not yet wired.

## 1. System purpose

The application supports the Mellow Art Market artist workflow:

1. An artist submits an application through a Webflow form.
2. Application data is stored in Cloudflare D1.
3. Portfolio and insurance documents are stored privately in Cloudflare R2.
4. An administrator reviews the application in this dashboard.
5. Accepted artists can be assigned an event-specific stall.
6. The dashboard creates an invoice through Xero.
7. Confirmation, approval, rejection, and waitlist messages are sent through
   the Gmail API.

The application and payment states are deliberately separate. Accepting an
application does not automatically mean that it has been invoiced or paid.

## 2. Runtime architecture

The frontend and backend are built and deployed together as one Cloudflare
Worker:

```text
                         +-----------------------+
                         | External services     |
                         | Webflow, Xero, Gmail  |
                         +----------+------------+
                                    |
                                    v
+---------------+        +----------+------------+
| Admin browser | <----> | Cloudflare Worker     |
| React UI      |        | React Router SSR      |
+---------------+        | loaders/actions/APIs  |
                         +-----+-------------+----+
                               |             |
                               v             v
                         +-----+-----+   +---+--------+
                         | D1        |   | R2         |
                         | SQL data  |   | Documents  |
                         +-----------+   +------------+
```

### Cloudflare components

| Component             | Name             | Binding/purpose                                     |
| --------------------- | ---------------- | --------------------------------------------------- |
| Worker                | `mellow-cf`      | Runs React Router SSR and all server logic          |
| D1 database           | `mellow-db`      | Available to server code as `env.DB`                |
| R2 bucket             | `mellow-uploads` | Available to server code as `env.BUCKET`            |
| Worker secrets        | Multiple         | JWT signing, public-form key, Xero and Google OAuth |
| Workers observability | Enabled          | Runtime logs and deployed source maps               |

The bindings are declared in `wrangler.jsonc`. That file connects the deployed
Worker to resources that already exist; it is not a complete infrastructure-as-
code provisioning system. D1 and R2 were provisioned manually with Wrangler.

There is currently no Cloudflare Queue, KV namespace, Durable Object, container,
or separate Cloudflare Pages project. There is also no deployment pipeline in
this repository; production deployment is a manual Wrangler command.

## 3. Request and data flows

### 3.1 Webflow application submission

```text
Artist
  -> Webflow form and embedded JavaScript
  -> multipart POST /api/submit with X-Client-Key
  -> validate text with Zod and validate document MIME type/size
  -> resolve event slug, Webflow item ID, or local event ID in D1
  -> upload documents to R2
  -> insert submission and document metadata into D1
  -> attempt confirmation email through Gmail
  -> return 201 and an ART-XXXXXXXX reference
```

The confirmation email is best-effort. A missing Gmail connection or email API
failure does not roll back a successfully stored application.

Files are uploaded before the D1 batch is written. This avoids database rows
pointing to missing files, but a D1 failure can leave orphaned R2 objects. A
future cleanup job or compensating delete would improve this behavior.

### 3.2 Admin page load

React Router route `loader()` functions execute inside the Worker. A protected
loader first calls `requireAdmin(request)`, then reads D1 or R2 through
Cloudflare bindings. The loader result is used for SSR and browser navigation.

Example server access:

```ts
import { env } from "cloudflare:workers";

const result = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
```

Cloudflare bindings must only be used in server code. Browser components should
receive loader data, submit to an action, or call a same-origin JSON endpoint.

### 3.3 Admin mutations

React Router `<Form>` and `useFetcher()` submissions invoke route `action()`
functions. Actions authenticate the administrator, validate the requested
intent, call a domain function under `app/lib`, and return structured data to
the UI.

Examples include:

- changing application status;
- assigning a stall;
- updating payment status;
- creating/editing events and stall options;
- changing invoice settings;
- managing administrators and email templates.

### 3.4 Internal JSON APIs

Interactive tables and dashboard summaries use same-origin APIs:

| Endpoint                 | Purpose                                                    | Authentication                |
| ------------------------ | ---------------------------------------------------------- | ----------------------------- |
| `GET /api/inquiries`     | Paginated/filterable application list and CSV/email export | Admin cookie                  |
| `GET /api/inquiries/:id` | Full application detail                                    | Admin cookie                  |
| `GET /api/summary`       | Dashboard counts                                           | Admin cookie                  |
| `GET /api/files/*`       | Stream a private R2 document                               | Admin cookie                  |
| `GET /email-assets/*`    | Stream an immutable public image embedded in an email      | Public, unguessable asset key |
| `POST /api/submit`       | Receive a public Webflow application                       | `X-Client-Key`                |

There is no separate backend hostname or API deployment. Admin API calls remain
on the same origin as the React application.

### 3.5 Xero invoicing

An administrator connects a Xero organisation through the authorization-code
OAuth flow. Tokens and the tenant identifier are stored in D1. When an access
token is near expiry, the Worker refreshes it and persists the rotated refresh
token.

An invoice can be created only when an application is accepted and has an
assigned stall. The assigned stall provides the price and currency. Invoice
creation happens inline during the admin action; there is no background Queue.

Payment status is currently administered through the dashboard. There is no
registered Xero webhook route in `app/routes.ts` that automatically synchronizes
payment status.

### 3.6 Gmail sending

An administrator connects one Gmail/Google Workspace mailbox using OAuth. The
Worker sends RFC-822 messages through the Gmail HTTPS API because Workers do not
use SMTP connections. OAuth tokens and the connected email address are stored
in D1 and refreshed on demand.

Email-template images are uploaded by authenticated administrators to the
existing R2 bucket under `email-assets/<uuid>.<extension>`. Unlike submission
documents, these objects are served through the public `/email-assets/*` route
because an email recipient does not have an admin session cookie. Uploads are
limited to validated PNG, JPEG, GIF, or WebP files of at most 5 MB. Their public
URLs are saved inside template block JSON or the shared branding row, so no new
D1 table is required.

## 4. Webflow boundaries

Webflow has two distinct concepts in the project documentation:

1. **Artist form integration:** implemented. Browser JavaScript maps Webflow
   fields to `POST /api/submit`.
2. **Webflow CMS event synchronization:** not implemented. The
   `syncEventsFromWebflow()` function is a Phase 2 stub and is not called.

Events are therefore created manually in the dashboard or inserted by
`seed.sql`. A submission's `eventSlug` may match a local event slug, Webflow item
ID, or local event ID. If it does not match, the submission is still accepted
but remains unassigned to an event.

Before implementing event-related enhancements, decide which system owns event
data:

- If Webflow is the source of truth, implement authenticated CMS synchronization
  with explicit field mapping, retry behavior, and deletion/archive rules.
- If D1 is the source of truth, remove the sync stub and update wording that says
  events are mirrored from Webflow.

## 5. Database model

The application uses Cloudflare D1, a SQL database with SQLite semantics. There
is no ORM. Server modules issue parameterized statements with `prepare()` and
`bind()`. Multi-statement operations use `db.batch()` where appropriate.

### Main relationships

```text
events
  1 -> many stall_options
  1 -> many submissions

submissions
  1 -> many submission_images (each row points to an R2 key)
  1 -> many invoice records
  1 -> many activity entries

admins
  -> authenticate dashboard sessions
  -> appear as actors in activity records
```

### Tables

| Table               | Responsibility                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `admins`            | Admin identity, name, email, and PBKDF2 password hash                                         |
| `submissions`       | Artist form data, workflow states, event/stall assignment, invoice link, notes, archive state |
| `submission_images` | R2 key, document kind, content type, size, and order                                          |
| `events`            | Local event identity, dates, location, slug, and optional Webflow item ID                     |
| `stall_options`     | Event-specific stall tier, slug, price, currency, furniture, frontage, and sharing rules      |
| `invoice_settings`  | Default Xero invoice and bank/payment configuration                                           |
| `invoices`          | Created Xero invoice snapshots and statuses                                                   |
| `xero_tokens`       | Singleton Xero OAuth token record                                                             |
| `google_tokens`     | Singleton Google OAuth token record                                                           |
| `activity_log`      | Auditable administrator workflow actions                                                      |
| `email_templates`   | Admin-editable email subject and content blocks                                               |
| `email_branding`    | Singleton shared email branding configuration                                                 |

### Schema changes

Migrations are ordered SQL files under `migrations/`. Never modify a migration
that may already have run in production. Add a new numbered migration, verify it
against local D1, and apply it remotely as a separate deployment step.

Remote migration execution is not part of `bun run deploy`.

## 6. Authentication and authorization

Dashboard administrators are stored in D1. Passwords are hashed using PBKDF2.
After login, the Worker creates an eight-hour signed JWT stored in an HTTP-only,
same-site cookie. Protected loaders/actions call `requireAdmin()`.

The public submission route uses a shared `X-Client-Key`. The current Webflow
embed places that value in browser JavaScript, meaning it is visible to every
visitor and must not be considered a secret.

Recommended public-form protection:

- rotate the currently exposed Worker secret and administrator credentials;
- remove credentials from tracked documentation and repository history;
- add Cloudflare Turnstile verification to the public form;
- apply rate limits and request-size limits at the edge;
- restrict CORS to expected form origins, while recognizing that CORS is not
  authentication;
- avoid logging submitted personal information in browser code.

## 7. Project structure

```text
app/
  components/       Shared application and shadcn UI components
  hooks/            Browser React hooks
  lib/              Domain types, utilities, and server modules
  routes/           Route UI, loaders, actions, and resource APIs
  app.css           Tailwind theme and global styles
  root.tsx          Root layout and React Query provider
  routes.ts         Explicit URL map

workers/
  app.ts            Cloudflare Worker entry point and CORS preflight handling

migrations/         Ordered D1 schema migrations
public/             Static public assets
scripts/            Maintenance scripts such as admin creation
docs/               API, infrastructure, operations, and architecture docs

wrangler.jsonc      Worker name, runtime flags, D1/R2 bindings, observability
vite.config.ts      React Router, Cloudflare, and Tailwind Vite plugins
react-router.config.ts
seed.sql            Development-only data
```

Files ending in `.server.ts` contain server-only logic and must not be imported
into browser bundles. Put constants/types needed by both environments in a
client-safe `.ts` module.

## 8. How to implement an enhancement

Use a vertical slice rather than editing the UI in isolation:

1. Find or add the URL in `app/routes.ts`.
2. Inspect the corresponding `app/routes/*.tsx` module.
3. Put initial reads in the route `loader()`.
4. Put mutations in the route `action()` and authenticate them.
5. Put reusable D1/external-service logic in an `app/lib/*.server.ts` module.
6. Add a new D1 migration if the persisted model changes.
7. Keep browser-safe validation/types in ordinary `app/lib/*.ts` modules.
8. Add focused unit tests for pure validation, state transitions, and payload
   conversion.
9. Run the full verification set.

```bash
bun run test
bun run typecheck
bun run build
```

For data-heavy behavior, also exercise the route against a migrated local D1
database. Unit tests alone do not prove migration and SQL compatibility.

## 9. Local development model

The Cloudflare Vite plugin runs the application in a local Workers-compatible
environment. Local D1 and R2 state is stored under `.wrangler/`; it does not
read or modify the production database or bucket.

Use the Bun-first setup in the repository README. For OAuth testing, register
the following callbacks in the provider applications and put their credentials
in `.dev.vars`:

```text
http://localhost:5173/xero/callback
http://localhost:5173/google/callback
```

The production Webflow embed is configured with a production API URL. To test a
real Webflow form against the local Worker, point the integration temporarily at
`http://localhost:5173/api/submit` and use the same development `CLIENT_KEY` as
`.dev.vars`. Do not publish a development endpoint or credential to the live
site.

## 10. Deployment sequence

Production resources are already referenced in `wrangler.jsonc`, but access to
the correct Cloudflare account is required.

Recommended sequence:

1. Run tests, type checks, and the production build.
2. Review new SQL migrations and back up important production data.
3. Check which migrations are pending remotely.
4. Apply D1 migrations with `--remote`.
5. Deploy the Worker.
6. Smoke-test login, dashboard reads, a non-destructive admin operation, and
   authenticated file delivery.
7. Review Worker logs for errors.

Commands used by this repository:

```bash
bun run test
bun run typecheck
bun run build
bunx wrangler d1 migrations apply mellow-db --remote
bun run deploy
```

Do not run remote migration or deployment commands merely to start local
development.

## 11. Known architectural gaps

- The Webflow CMS event sync function is a stub.
- The browser-visible static `CLIENT_KEY` does not securely authenticate the
  public form.
- Historical documentation contains exposed credentials and needs redaction
  after those credentials are rotated.
- D1 and R2 writes are not one atomic transaction; failed D1 writes can leave
  orphaned R2 objects.
- Xero payment state is not automatically synchronized by a registered webhook
  route.
- Remote migrations and Worker deployment are separate manual operations.
- There is no infrastructure-as-code definition or CI/CD workflow.
- Runtime/package-manager versions are not pinned for the team.

These are useful starting points for hardening work before adding large new
features.
