-- SQLite cannot widen the status CHECK in place. Rebuild the parent table,
-- preserving every column added through 0015 and its existing identifiers.
-- Save child tables without their foreign keys first: DROP TABLE on the parent
-- can execute ON DELETE CASCADE even while foreign key checks are deferred.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE submission_images_backup AS SELECT * FROM submission_images;
CREATE TABLE invoices_backup AS SELECT * FROM invoices;
DROP TABLE submission_images;
DROP TABLE invoices;

CREATE TABLE submissions_new (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  applied_before TEXT,
  brand_name TEXT,
  website TEXT,
  instagram TEXT,
  bio TEXT NOT NULL,
  primary_category TEXT,
  secondary_category TEXT,
  product_description TEXT,
  additional_notes TEXT,
  consent_debut INTEGER NOT NULL DEFAULT 0,
  consent_sharing INTEGER NOT NULL DEFAULT 0,
  consent_setup_guide INTEGER NOT NULL DEFAULT 0,
  first_stall_preference TEXT,
  second_stall_preference TEXT,
  offer_mini_if_unavailable TEXT,
  sharing_stall TEXT,
  has_insurance TEXT,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'waitlisted', 'rejected', 'withdrawn')),
  reject_reason TEXT,
  decided_by TEXT,
  decided_at TEXT,
  stall_option_id TEXT REFERENCES stall_options(id) ON DELETE SET NULL,
  payment_status TEXT NOT NULL DEFAULT 'none'
    CHECK (payment_status IN ('none', 'invoicing', 'awaiting_payment', 'paid', 'overdue', 'voided')),
  xero_invoice_id TEXT,
  invoice_url TEXT,
  paid_at TEXT,
  internal_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  waitlist_reason TEXT,
  second_artist_first_name TEXT,
  second_artist_last_name TEXT,
  second_artist_email TEXT,
  second_artist_applied_before TEXT,
  second_artist_brand_name TEXT,
  second_artist_website TEXT,
  second_artist_instagram TEXT,
  second_artist_bio TEXT,
  second_artist_primary_category TEXT,
  second_artist_secondary_category TEXT,
  second_artist_product_description TEXT,
  archived_at TEXT
);

INSERT INTO submissions_new (
  id, first_name, last_name, email, applied_before, brand_name, website,
  instagram, bio, primary_category, secondary_category, product_description,
  additional_notes, consent_debut, consent_sharing, consent_setup_guide,
  first_stall_preference, second_stall_preference, offer_mini_if_unavailable,
  sharing_stall, has_insurance, event_id, status, reject_reason, decided_by,
  decided_at, stall_option_id, payment_status, xero_invoice_id, invoice_url,
  paid_at, internal_notes, created_at, updated_at, waitlist_reason,
  second_artist_first_name, second_artist_last_name, second_artist_email,
  second_artist_applied_before, second_artist_brand_name, second_artist_website,
  second_artist_instagram, second_artist_bio, second_artist_primary_category,
  second_artist_secondary_category, second_artist_product_description, archived_at
)
SELECT
  id, first_name, last_name, email, applied_before, brand_name, website,
  instagram, bio, primary_category, secondary_category, product_description,
  additional_notes, consent_debut, consent_sharing, consent_setup_guide,
  first_stall_preference, second_stall_preference, offer_mini_if_unavailable,
  sharing_stall, has_insurance, event_id, status, reject_reason, decided_by,
  decided_at, stall_option_id, payment_status, xero_invoice_id, invoice_url,
  paid_at, internal_notes, created_at, updated_at, waitlist_reason,
  second_artist_first_name, second_artist_last_name, second_artist_email,
  second_artist_applied_before, second_artist_brand_name, second_artist_website,
  second_artist_instagram, second_artist_bio, second_artist_primary_category,
  second_artist_secondary_category, second_artist_product_description, archived_at
FROM submissions;

DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;

CREATE TABLE submission_images (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('profile', 'portfolio', 'insurance', 'second_portfolio')),
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO submission_images (id, submission_id, kind, r2_key, content_type, size, sort_order, created_at)
SELECT id, submission_id, kind, r2_key, content_type, size, sort_order, created_at
FROM submission_images_backup;
DROP TABLE submission_images_backup;
CREATE INDEX idx_submission_images_submission ON submission_images(submission_id);

CREATE TABLE invoices (
  xero_invoice_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  invoice_number TEXT,
  currency TEXT,
  unit_amount REAL,
  total REAL,
  amount_due REAL,
  status TEXT,
  online_url TEXT,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO invoices (
  xero_invoice_id, submission_id, invoice_number, currency, unit_amount,
  total, amount_due, status, online_url, reference, created_at, updated_at
)
SELECT
  xero_invoice_id, submission_id, invoice_number, currency, unit_amount,
  total, amount_due, status, online_url, reference, created_at, updated_at
FROM invoices_backup;
DROP TABLE invoices_backup;
CREATE INDEX idx_invoices_submission ON invoices(submission_id);

CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_payment_status ON submissions(payment_status);
CREATE INDEX idx_submissions_created_at ON submissions(created_at);
CREATE INDEX idx_submissions_xero_invoice ON submissions(xero_invoice_id);
CREATE INDEX idx_submissions_event ON submissions(event_id);
CREATE INDEX idx_submissions_stall_option ON submissions(stall_option_id);
CREATE INDEX idx_submissions_archived ON submissions(archived_at);
PRAGMA defer_foreign_keys = OFF;
