CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE public.sightings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  location extensions.geography(Point, 4326) NOT NULL,
  heading double precision NOT NULL CHECK (heading >= 0 AND heading <= 360),
  dog_count smallint NOT NULL CHECK (dog_count BETWEEN 1 AND 3),
  off_leash boolean,
  temperature_c double precision,
  precipitation_mm double precision,
  wind_ms double precision,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sightings_location_gist_idx
  ON public.sightings USING gist (location);

CREATE INDEX sightings_seen_at_idx
  ON public.sightings (seen_at);

CREATE INDEX sightings_user_created_at_idx
  ON public.sightings (user_id, created_at);

ALTER TABLE public.sightings ENABLE ROW LEVEL SECURITY;

CREATE POLICY sightings_select_own
  ON public.sightings FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY sightings_insert_own
  ON public.sightings FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY sightings_update_own
  ON public.sightings FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY sightings_delete_own
  ON public.sightings FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sightings TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE private.sighting_insert_log (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  inserted_at timestamptz NOT NULL
);

CREATE INDEX sighting_insert_log_inserted_at_idx
  ON private.sighting_insert_log (inserted_at);

CREATE INDEX sighting_insert_log_user_inserted_at_idx
  ON private.sighting_insert_log (user_id, inserted_at);

ALTER TABLE private.sighting_insert_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.sighting_insert_log FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.enforce_sighting_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_time timestamptz;
  recent_count bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;

    IF NEW.seen_at IS DISTINCT FROM OLD.seen_at THEN
      request_time := pg_catalog.clock_timestamp();
      IF NEW.seen_at > request_time OR NEW.seen_at < request_time - interval '24 hours' THEN
        RAISE EXCEPTION 'seen_at must be within the last 24 hours and not in the future'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(NEW.user_id::text, 0)
    );

    request_time := pg_catalog.clock_timestamp();

    IF NEW.seen_at > request_time OR NEW.seen_at < request_time - interval '24 hours' THEN
      RAISE EXCEPTION 'seen_at must be within the last 24 hours and not in the future'
        USING ERRCODE = '23514';
    END IF;

    NEW.created_at := request_time;

    DELETE FROM private.sighting_insert_log
     WHERE inserted_at <= request_time - interval '24 hours';

    SELECT count(*)
      INTO recent_count
      FROM private.sighting_insert_log
     WHERE user_id = NEW.user_id
       AND inserted_at > request_time - interval '24 hours';

    IF recent_count >= 50 THEN
      RAISE EXCEPTION 'maximum of 50 sightings per user per 24 hours exceeded'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO private.sighting_insert_log (user_id, inserted_at)
    VALUES (NEW.user_id, request_time);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_sighting_limits() FROM PUBLIC;

CREATE TRIGGER sightings_enforce_limits
  BEFORE INSERT OR UPDATE ON public.sightings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sighting_limits();