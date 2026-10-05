-- Requests submitted through the public booking form. They stay "pending" until the owners
-- accept (which creates an appointment or series) or decline. Personal data here is short-lived:
-- decided requests and stale pending ones are purged automatically (see services/requests.ts).
CREATE TABLE booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 120),
  client_phone text NOT NULL CHECK (char_length(client_phone) BETWEEN 7 AND 30),
  address text NOT NULL CHECK (char_length(address) BETWEEN 1 AND 250),
  preferred_date date NOT NULL,
  preferred_time text NOT NULL CHECK (preferred_time ~ '^\d{2}:\d{2}$'),
  repeat text NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'weekly', 'biweekly', 'monthly')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  lang text NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  series_id uuid REFERENCES series(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_requests_status_idx ON booking_requests (status, created_at);
