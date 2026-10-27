PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '✦',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS historical_events (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 9999),
  era TEXT NOT NULL DEFAULT 'CE' CHECK (era IN ('BCE','CE')),
  exact_date TEXT,
  year_display TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  period TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  region TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  fact_check_status TEXT NOT NULL DEFAULT 'reviewed' CHECK (fact_check_status IN ('draft','needs-review','reviewed')),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS historical_events_category_year ON historical_events(category_id, year);
CREATE INDEX IF NOT EXISTS historical_events_period ON historical_events(period);
CREATE INDEX IF NOT EXISTS historical_events_published ON historical_events(published, difficulty);

CREATE TABLE IF NOT EXISTS question_translations (
  event_id TEXT NOT NULL REFERENCES historical_events(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  question_text TEXT NOT NULL,
  PRIMARY KEY (event_id, locale)
);

CREATE TABLE IF NOT EXISTS content_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES historical_events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_challenges (
  challenge_date TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES historical_events(id),
  assigned_by TEXT NOT NULL DEFAULT 'planner',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  client_key TEXT NOT NULL,
  challenge_date TEXT,
  event_id TEXT NOT NULL REFERENCES historical_events(id),
  mode TEXT NOT NULL CHECK (mode IN ('daily','archive','practice')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT CHECK (result IN ('won','lost') OR result IS NULL),
  attempts_used INTEGER NOT NULL DEFAULT 0 CHECK (attempts_used BETWEEN 0 AND 6),
  UNIQUE(client_key, challenge_date, mode)
);

CREATE INDEX IF NOT EXISTS game_sessions_client_date ON game_sessions(client_key, challenge_date, mode);
CREATE INDEX IF NOT EXISTS game_sessions_client_result ON game_sessions(client_key, result, completed_at);

CREATE TABLE IF NOT EXISTS guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  value TEXT NOT NULL CHECK (length(value) = 4),
  feedback_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, position)
);
