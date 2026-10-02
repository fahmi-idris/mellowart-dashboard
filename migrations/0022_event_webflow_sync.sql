ALTER TABLE events ADD COLUMN webflow_sync_status TEXT CHECK (webflow_sync_status IN ('pending','synced','failed'));
ALTER TABLE events ADD COLUMN webflow_sync_error TEXT;
ALTER TABLE events ADD COLUMN webflow_synced_at TEXT;
ALTER TABLE events ADD COLUMN webflow_collection_id TEXT;
ALTER TABLE events ADD COLUMN webflow_sync_version TEXT;
ALTER TABLE events ADD COLUMN webflow_sync_lock TEXT;
ALTER TABLE events ADD COLUMN webflow_sync_lock_until INTEGER;
-- Retain uncertain create attempts so retries reconcile rather than blindly POST again.
ALTER TABLE events ADD COLUMN webflow_create_slug TEXT;
