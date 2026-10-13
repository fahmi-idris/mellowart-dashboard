-- A decision email is sent manually after a status change. Keep its state on
-- the submission so the UI can hide Send Email after Gmail accepts the message.
ALTER TABLE submissions ADD COLUMN decision_email_sent_at TEXT;

-- Optional withdrawal note, matching rejection and waitlist reasons.
ALTER TABLE submissions ADD COLUMN withdrawn_reason TEXT;

-- Preserve already-sent decision emails logged by earlier versions. Only a
-- send after the latest decision counts, so a changed status can be emailed.
UPDATE submissions
SET decision_email_sent_at = (
  SELECT MAX(a.created_at)
    FROM activity_log a
   WHERE a.submission_id = submissions.id
     AND a.type = 'email_sent'
     AND a.created_at >= COALESCE(submissions.decided_at, submissions.created_at)
)
WHERE status IN ('rejected', 'waitlisted', 'withdrawn');
