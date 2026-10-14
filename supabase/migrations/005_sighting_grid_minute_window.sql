DROP FUNCTION IF EXISTS public.get_sighting_grid(
  integer, integer, integer,
  double precision, double precision, double precision, double precision
);

CREATE OR REPLACE FUNCTION public.get_sighting_grid(
  center_minute integer,
  half_window_minutes integer,
  min_lon double precision,
  min_lat double precision,
  max_lon double precision,
  max_lat double precision
)
RETURNS TABLE (
  longitude double precision,
  latitude double precision,
  observation_count bigint,
  heat_weight double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF center_minute NOT BETWEEN 0 AND 10079
     OR half_window_minutes NOT BETWEEN 1 AND 180
     OR min_lon < -180 OR max_lon > 180
     OR min_lat < -90 OR max_lat > 90
     OR min_lon >= max_lon OR min_lat >= max_lat THEN
    RAISE EXCEPTION 'invalid time window or bounding box'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH bounded_sightings AS (
    SELECT
      s.user_id,
      extensions.ST_SnapToGrid(
        extensions.ST_Transform(s.location::extensions.geometry, 3067),
        100.0
      ) AS grid_cell,
      -- Viikon minuutti Helsingin ajassa (su 00:00 = 0).
      (
        EXTRACT(DOW FROM s.seen_at AT TIME ZONE 'Europe/Helsinki')::integer * 1440
        + EXTRACT(HOUR FROM s.seen_at AT TIME ZONE 'Europe/Helsinki')::integer * 60
        + EXTRACT(MINUTE FROM s.seen_at AT TIME ZONE 'Europe/Helsinki')::integer
      ) AS local_minute,
      CASE
        WHEN s.seen_at >= pg_catalog.now() - interval '12 months' THEN 1.0
        ELSE 0.25
      END AS recency_weight
    FROM public.sightings AS s
    WHERE s.location OPERATOR(extensions.&&) extensions.ST_MakeEnvelope(
      min_lon, min_lat, max_lon, max_lat, 4326
    )::extensions.geography
      AND extensions.ST_Intersects(
        s.location,
        extensions.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
          ::extensions.geography
      )
  ),
  filtered_sightings AS (
    SELECT *
    FROM bounded_sightings
    WHERE LEAST(
      pg_catalog.abs(local_minute - center_minute),
      10080 - pg_catalog.abs(local_minute - center_minute)
    ) <= half_window_minutes
  ),
  aggregated_cells AS (
    SELECT
      grid_cell,
      pg_catalog.count(*)::bigint AS observation_count,
      pg_catalog.count(DISTINCT user_id)::bigint AS user_count,
      pg_catalog.sum(recency_weight)::double precision AS heat_weight
    FROM filtered_sightings
    GROUP BY grid_cell
    HAVING pg_catalog.count(DISTINCT user_id) >= 3
  ),
  cell_centers AS (
    SELECT
      extensions.ST_Transform(extensions.ST_Centroid(cells.grid_cell), 4326) AS center,
      cells.observation_count,
      cells.heat_weight
    FROM aggregated_cells AS cells
  )
  SELECT
    extensions.ST_X(centers.center),
    extensions.ST_Y(centers.center),
    centers.observation_count,
    centers.heat_weight
  FROM cell_centers AS centers;
END;
$$;
