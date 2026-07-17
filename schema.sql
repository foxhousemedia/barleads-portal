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

-- One-time login codes for the custom auth flow (replaced Cloudflare Access).
-- Codes are stored hashed (SHA-256 + server secret), expire after 10 minutes,
-- and are single-use. Old rows are pruned opportunistically.
CREATE TABLE IF NOT EXISTS login_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  ip          TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes (email, used, expires_at);
