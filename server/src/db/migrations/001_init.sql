CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- All instants are stored in UTC. Display conversion to America/Los_Angeles happens in code.
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 120),
  client_phone text CHECK (client_phone IS NULL OR char_length(client_phone) <= 30),
  address text NOT NULL CHECK (char_length(address) BETWEEN 1 AND 250),
  starts_at timestamptz NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 15 AND 720),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_starts_at_idx ON appointments (starts_at);

-- Who did what, never the personal data itself.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid
);

-- Privacy-respecting usage counts: event name + day + count. No identifiers.
CREATE TABLE usage_counters (
  event text NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event, day)
);

-- Server-side sessions (connect-pg-simple).
CREATE TABLE sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions (expire);
