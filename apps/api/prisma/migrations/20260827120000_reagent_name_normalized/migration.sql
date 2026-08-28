-- Accent-insensitive name search (spec §6.1). Postgres' own unaccent() is
-- STABLE, not IMMUTABLE, because its behaviour depends on a dictionary that
-- could be changed. A generated column and an expression index both require
-- IMMUTABLE, so we wrap it: the wrapper pins the dictionary by name, which is
-- what makes the promise safe to keep.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Stored, not computed per query: the search runs on every keystroke of the
-- reagents filter, while a reagent's name changes almost never.
ALTER TABLE "Reagent"
  ADD COLUMN "nameNormalized" text
  GENERATED ALWAYS AS (f_unaccent(lower("name"))) STORED;

-- Trigram GIN, because the filter is a substring match: a btree index cannot
-- serve `LIKE '%acido%'`, which is unanchored at both ends.
CREATE INDEX "Reagent_nameNormalized_trgm_idx"
  ON "Reagent" USING gin ("nameNormalized" gin_trgm_ops);
