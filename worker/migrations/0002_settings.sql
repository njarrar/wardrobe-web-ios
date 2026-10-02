-- Settings saved from the app, such as the AI provider and its API keys.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
