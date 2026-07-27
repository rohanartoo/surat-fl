alter table public.gameweek_points
  add column if not exists slot_type text check (slot_type in ('starting', 'bench')),
  add column if not exists counted boolean not null default true;
