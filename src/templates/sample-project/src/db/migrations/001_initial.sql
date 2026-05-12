-- Initial schema for TaskFlow
-- Forward-only migration. Roll-back happens via 001_initial_down.sql.

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT,
  google_id     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_google_id_unique ON users (google_id) WHERE google_id IS NOT NULL;

CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id               UUID NOT NULL REFERENCES teams(id),
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'open',
  assigned_to_user_id   UUID REFERENCES users(id),
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tasks_assigned_to_user_id ON tasks (assigned_to_user_id);
CREATE INDEX tasks_team_id ON tasks (team_id);
