-- A series stores the RULE (local wall-clock time + frequency). Individual visits are
-- generated on demand; only changed or cancelled visits are stored, as "exception" rows
-- in appointments (series_id + original_date identify which generated visit they replace).
CREATE TABLE series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 120),
  client_phone text CHECK (client_phone IS NULL OR char_length(client_phone) <= 30),
  address text NOT NULL CHECK (char_length(address) BETWEEN 1 AND 250),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  start_date date NOT NULL,                       -- Pacific calendar date of the first visit
  local_time text NOT NULL CHECK (local_time ~ '^\d{2}:\d{2}$'),  -- Pacific wall-clock time
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 15 AND 720),
  freq text NOT NULL CHECK (freq IN ('weekly', 'biweekly', 'monthly')),
  until_date date,                                -- inclusive; NULL = no end
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE appointments
  ADD COLUMN series_id uuid REFERENCES series(id) ON DELETE CASCADE,
  ADD COLUMN original_date date,
  ADD CONSTRAINT appointments_series_pair CHECK ((series_id IS NULL) = (original_date IS NULL));

CREATE UNIQUE INDEX appointments_series_occurrence_idx
  ON appointments (series_id, original_date) WHERE series_id IS NOT NULL;
