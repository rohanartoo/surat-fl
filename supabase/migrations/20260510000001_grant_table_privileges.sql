-- Grant SELECT privileges to authenticated and anon roles on all public tables.
-- Writes go through service-role API routes which bypass RLS; these grants
-- cover server-component reads. RLS policies enforce row-level restrictions.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
