-- Event branding is stored as JSON; these columns support the global fallback.
-- Keep summary colors independent from the header and preserve existing branding.
ALTER TABLE email_branding ADD COLUMN body_bg TEXT NOT NULL DEFAULT '#F5F5F0';
ALTER TABLE email_branding ADD COLUMN body_text_color TEXT NOT NULL DEFAULT '#2C2422';
ALTER TABLE email_branding ADD COLUMN hero_text_color TEXT NOT NULL DEFAULT '';
ALTER TABLE email_branding ADD COLUMN summary_bg TEXT NOT NULL DEFAULT '#FFFDF2';
ALTER TABLE email_branding ADD COLUMN summary_text_color TEXT NOT NULL DEFAULT '#2C2422';
