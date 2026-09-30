-- Event-specific overrides. Existing global templates/branding remain the
-- fallback for legacy submissions and for events not customized yet.
CREATE TABLE IF NOT EXISTS event_email_templates (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  subject TEXT NOT NULL,
  preheader TEXT,
  blocks TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT,
  PRIMARY KEY (event_id, key)
);

CREATE TABLE IF NOT EXISTS event_email_branding (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  branding TEXT NOT NULL,
  updated_at TEXT
);
