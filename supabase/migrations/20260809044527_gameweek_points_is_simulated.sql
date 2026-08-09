-- simulate-gw had no way to distinguish "real FPL-synced data" from
-- "previously simulated data" for a given gameweek — the /check route could
-- only report "this GW has some rows", not whether overwriting them would
-- destroy real season results. This column lets both routes tell the
-- difference and gate accordingly.

alter table public.gameweek_points add column if not exists is_simulated boolean not null default false;
