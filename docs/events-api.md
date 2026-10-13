# Public events API

`GET /api/events` is a read-only public catalog. It contains event content only,
never applicant records, administrator details, OAuth credentials or Webflow IDs.
Cross-origin GET requests are allowed so a Webflow page can use the catalog.

## Query parameters

| Parameter                    | Behavior                                                 |
| ---------------------------- | -------------------------------------------------------- |
| `limit`                      | Page size, 1–100, default 20                             |
| `cursor`                     | Opaque `next_cursor` from the previous page              |
| `event_name`                 | Case-insensitive partial name search (literal `%` / `_`) |
| `locations` (or `location`)  | Exact location reference name                            |
| `category`, `theme`, `month` | Exact reference names                                    |
| `event_status`               | `upcoming`, `on_going`, `inactive`, or `all`             |

Repeat a reference parameter to match any of its values. Different fields combine
with AND. Default results include upcoming and ongoing events only; undated legacy
events are omitted unless `event_status=all`. Status uses UTC date-only boundaries,
and the end date is inclusive. All results are ordered by start date then internal
ID. Keep filters unchanged when following a cursor; reset the cursor when filters change.

Example: `/api/events?limit=12&locations=Melbourne&theme=Art&event_status=upcoming`

```json
{
  "data": [
    {
      "event_name": "Mellow Art Market",
      "slug": "mellow-art-market",
      "start_date": "2026-10-03",
      "end_date": "2026-10-04",
      "event_status": "upcoming",
      "category": ["Market"],
      "theme": ["Art"],
      "summary": "A weekend of art and stationery.",
      "image": "https://your-worker.example/event-assets/uuid.png",
      "description": "<p>Meet independent artists.</p>",
      "location": ["Melbourne"],
      "month": ["October"]
    }
  ],
  "pagination": { "limit": 12, "has_more": false, "next_cursor": null }
}
```

For infinite loading append each page's `data` and request the next page with
`cursor=encodeURIComponent(next_cursor)`. Stop when `has_more` is false. Invalid
pagination/filter inputs return JSON HTTP 400. Image URLs are absolute. Rich text
is sanitized on write; plain-text names/summary still need normal escaping when
rendered by consumers. `event_status=all` can also return `inactive` and `unscheduled`
for legacy records without dates.

## Schema rollout

Apply migrations through `0022_event_webflow_sync.sql` before deploying this code.
The production release script already applies pending migrations. For local testing:
`bun run db:migrate:local`. For dev: `bun run db:migrate:dev` before `bun run deploy:dev`.
No remote migration is performed merely by editing the code.

## Webflow ownership

The dashboard database is canonical. `webflow_id` remains an integration-only
external reference, is not editable in the form, and is preserved on updates.
Legacy location text is backfilled into reusable location references; a compatibility
location string remains for existing dashboard views. New references are stored once
per type/name and linked to events. Optional event content is stored in the application
model independently of Webflow field slugs.

Create event and Save changes save D1 first, then automatically create/update and
publish the Webflow item. Cards show pending/synced/failed status and a Retry sync
action. A Webflow failure never rolls back the event save. Existing events can be
published using Retry sync; there is no automatic bulk backfill.

Configure `WEBFLOW_ACCESS_TOKEN` (CMS read/write), `WEBFLOW_SITE_ID`, and
`WEBFLOW_EVENT_COLLECTION_ID` in `.dev.vars` locally, or Worker secrets for each
deployed environment. The token never reaches the browser. The integration validates
that the collection belongs to the site and reads its schema before each sync.
`app/lib/webflow/mapper.server.ts` centralizes field aliases; actual API slugs are
resolved from the schema display names. Unknown fields, such as Profile Avatars,
are left untouched. Category stays app-only if there is no CMS category field.

Theme/location/month reference collection IDs are discovered from the schema.
Selected names must exactly match one non-archived item in the linked CMS collection.
New dashboard references are not automatically created in Webflow: add their CMS
items first and retry. Single Reference fields accept at most one value. Switch the
Webflow field to Multi-reference to publish multiple selections; none are silently dropped.

Images must have a public HTTPS URL. Optional `WEBFLOW_ASSET_BASE_URL` can point
to the deployed app serving the uploaded file when saving from localhost. Merely
setting a URL does not copy locally stored R2 files to the deployed bucket.

Sync has a 45-second network deadline and a 90-second D1 lease. A newer edit during
sync stays pending rather than being marked published by the older request; Retry
sync publishes the latest version. Item IDs are persisted before publishing so publish
retries update the same item, including when its slug changes. An uncertain create
outcome is reconciled using the saved attempt slug; a normal save never adopts an
unlinked CMS item by slug. If reconciliation cannot find exactly one item, it stops
for manual inspection rather than blindly creating a duplicate. Deleted CMS items
are not silently replaced. Changing a linked event's configured collection is blocked.

The Delete confirmation unpublishes a linked Webflow item first, leaving it as a CMS
draft, then deletes the local event and its stall options. Applications remain with
their event/stall assignments cleared. If Webflow fails, the local event is kept and
the dialog shows an error. Already-unpublished/missing live items can be deleted
after validating collection access. A never-linked event needs no Webflow configuration.
Active syncs and unresolved create attempts block deletion; a newer concurrent edit
is preserved. Unpublishing and deleting cannot be one transaction across systems:
if local deletion fails after unpublishing, the local record stays pending for retry.
The CMS draft can be recovered in Webflow, but the dashboard record/stall options
require a database backup to restore. Durable background retries remain a future workflow.

API references: [Collection schema](https://developers.webflow.com/data/reference/cms/collections/get),
[create items](https://developers.webflow.com/data/reference/cms/collection-items/staged-items/create-item),
[publish items](https://developers.webflow.com/data/reference/cms/collection-items/staged-items/publish-item).
