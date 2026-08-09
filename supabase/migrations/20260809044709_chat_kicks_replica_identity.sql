-- Realtime DELETE payloads only include a row's primary key by default —
-- ChatPanel's un-kick handler reads payload.old.guest_name (not the PK), so
-- it always received undefined and never actually removed the un-kicked name
-- from local state, leaving them locked out until a full page reload.

alter table public.chat_kicks replica identity full;
