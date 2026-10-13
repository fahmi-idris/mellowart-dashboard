ALTER TABLE events ADD COLUMN summary TEXT;
ALTER TABLE events ADD COLUMN description TEXT;
ALTER TABLE events ADD COLUMN image TEXT;

CREATE TABLE event_references (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('category', 'theme', 'location', 'month')),
  name TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (kind, name)
);
CREATE TABLE event_reference_links (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL REFERENCES event_references(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, reference_id)
);
CREATE INDEX idx_event_reference_links_reference ON event_reference_links(reference_id, event_id);
CREATE INDEX idx_events_date_id ON events(COALESCE(substr(starts_at, 1, 10), ''), id);

-- Preserve legacy locations as reusable choices (do not split a place name on commas).
INSERT INTO event_references (id, kind, name)
SELECT 'REF-' || lower(hex(randomblob(16))), 'location', trim(location)
FROM events WHERE trim(COALESCE(location, '')) <> '' GROUP BY trim(location) COLLATE NOCASE;
INSERT INTO event_reference_links (event_id, reference_id)
SELECT e.id, r.id FROM events e JOIN event_references r
ON r.kind = 'location' AND r.name = trim(e.location) COLLATE NOCASE;
