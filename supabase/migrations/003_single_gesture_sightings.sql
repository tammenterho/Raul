ALTER TABLE public.sightings
  DROP COLUMN IF EXISTS dog_count,
  DROP COLUMN IF EXISTS off_leash,
  DROP COLUMN IF EXISTS notes,
  ALTER COLUMN seen_at SET DEFAULT now(),
  ALTER COLUMN heading TYPE numeric USING heading::numeric;

DROP POLICY IF EXISTS sightings_update_own ON public.sightings;
REVOKE UPDATE ON public.sightings FROM authenticated;

DROP POLICY IF EXISTS sightings_insert_own ON public.sightings;
CREATE POLICY sightings_insert_own
  ON public.sightings FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND seen_at >= now() - interval '1 minute'
    AND seen_at <= now() + interval '1 minute'
  );

DROP TRIGGER IF EXISTS sightings_enforce_limits ON public.sightings;

CREATE OR REPLACE FUNCTION public.enforce_sighting_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_time timestamptz := pg_catalog.clock_timestamp();
  recent_count bigint;
BEGIN
  NEW.seen_at := pg_catalog.now();
  NEW.created_at := pg_catalog.now();

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.user_id::text, 0)
  );

  request_time := pg_catalog.clock_timestamp();

  DELETE FROM private.sighting_insert_log
   WHERE inserted_at <= request_time - interval '24 hours';

  SELECT count(*)
    INTO recent_count
    FROM private.sighting_insert_log
   WHERE user_id = NEW.user_id
     AND inserted_at > request_time - interval '24 hours';

  IF recent_count >= 100 THEN
    RAISE EXCEPTION 'maximum of 100 sightings per user per 24 hours exceeded'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO private.sighting_insert_log (user_id, inserted_at)
  VALUES (NEW.user_id, request_time);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_sighting_limits() FROM PUBLIC;

CREATE TRIGGER sightings_enforce_limits
  BEFORE INSERT ON public.sightings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sighting_limits();