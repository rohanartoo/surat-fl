-- bigserial creates a backing sequence with its own separate privilege set —
-- granting insert on the table doesn't cover it. rpc_place_bid runs as the
-- calling team's own role (no `security definer`), so without this grant
-- any bid/fold/etc. that writes to auction_log fails with "permission
-- denied for sequence auction_log_seq_seq" the moment it tries to insert.
grant usage, select on sequence public.auction_log_seq_seq to authenticated, anon, service_role;
