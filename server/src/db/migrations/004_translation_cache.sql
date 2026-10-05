-- Cache of machine translations of notes, so the same note is never translated twice (the free
-- provider has a daily allowance). Keyed by a hash of (source language, target language, text),
-- so it is not tied to a person. Rows are deleted after 30 days (see services/translations.ts).
CREATE TABLE translation_cache (
  source_hash text PRIMARY KEY,
  source_lang text NOT NULL CHECK (source_lang IN ('es', 'en')),
  target_lang text NOT NULL CHECK (target_lang IN ('es', 'en')),
  translated_text text NOT NULL CHECK (char_length(translated_text) <= 4000),
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX translation_cache_created_idx ON translation_cache (created_at);
