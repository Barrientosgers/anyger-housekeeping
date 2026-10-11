-- More detail on public booking requests: how to reach the client, what kind of place, a move-in
-- or move-out clean, and a structured address (city and ZIP required, street and unit optional).
-- Old rows keep their single address line and have NULL in the new columns.
ALTER TABLE booking_requests
  ALTER COLUMN address DROP NOT NULL,
  DROP CONSTRAINT booking_requests_address_check,
  ADD CONSTRAINT booking_requests_address_check
    CHECK (address IS NULL OR char_length(address) BETWEEN 1 AND 250),
  ADD COLUMN unit text CHECK (unit IS NULL OR char_length(unit) BETWEEN 1 AND 40),
  ADD COLUMN city text CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 80),
  ADD COLUMN zip text CHECK (zip IS NULL OR zip ~ '^\d{5}(-\d{4})?$'),
  ADD COLUMN contact_method text NOT NULL DEFAULT 'call'
    CHECK (contact_method IN ('call', 'text', 'email')),
  ADD COLUMN contact_email text CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  ADD COLUMN cleaning_type text CHECK (cleaning_type IN ('apartment', 'house', 'office')),
  ADD COLUMN move_type text NOT NULL DEFAULT 'none' CHECK (move_type IN ('none', 'move_in', 'move_out'));
