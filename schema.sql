-- BarLeads client portal — one row per venue, keyed by the Cloudflare Access email.
-- The portal state is stored as a single JSON blob; media lives in R2 (URLs only in the JSON).
CREATE TABLE IF NOT EXISTS venues (
  email       TEXT PRIMARY KEY,
  venue_name  TEXT,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Optional: submission log so BarLeads knows when a venue hit "Submit".
CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
