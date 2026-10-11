ALTER TABLE public.sightings
  ALTER COLUMN seen_at SET DEFAULT now(),
  ALTER COLUMN dog_count DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS edge_id uuid;