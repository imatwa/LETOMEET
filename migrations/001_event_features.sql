-- Run once in the Neon SQL Editor against the database used by Vercel.
-- Additive only: existing events and their content are preserved.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.event
  ADD COLUMN IF NOT EXISTS creator_id INTEGER,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS moderation_comment TEXT,
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS card_color VARCHAR(20) NOT NULL DEFAULT 'cream',
  ADD COLUMN IF NOT EXISTS card_emoji VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tagline VARCHAR(80);
CREATE TABLE IF NOT EXISTS public.event_image (
  id VARCHAR(32) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public."user"(id),
  data BYTEA NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMIT;
