-- Chat messages
create table public.chat_messages (
  id          uuid        primary key default gen_random_uuid(),
  auction_id  uuid        references public.auctions(id) on delete cascade,
  user_id     uuid        references auth.users(id) on delete cascade,
  author_name text        not null,
  is_guest    boolean     not null default false,
  message     text        not null check (char_length(message) between 1 and 500),
  created_at  timestamptz not null default now()
);

alter table public.chat_messages enable row level security;
create policy "Anyone can read chat" on public.chat_messages for select using (true);
create policy "Authenticated users can delete own messages" on public.chat_messages
  for delete using (auth.uid() = user_id);

grant select on public.chat_messages to authenticated, anon;
grant delete on public.chat_messages to authenticated;

alter publication supabase_realtime add table public.chat_messages;

create index on public.chat_messages (auction_id, created_at asc);
create index on public.chat_messages (created_at asc) where auction_id is null;

-- Kicked guest names
create table public.chat_kicks (
  id         uuid        primary key default gen_random_uuid(),
  guest_name text        not null unique,
  kicked_at  timestamptz not null default now()
);

alter table public.chat_kicks enable row level security;
create policy "Anyone can read kicks" on public.chat_kicks for select using (true);

grant select on public.chat_kicks to authenticated, anon;

alter publication supabase_realtime add table public.chat_kicks;
