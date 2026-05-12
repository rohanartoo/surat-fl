-- =============================================
-- Surat Fantasy League — Supabase Schema
-- (Auto-generated via pg_dump, commented for readability)
-- =============================================



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

COMMENT ON SCHEMA "public" IS 'standard public schema';

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select role from public.profiles where id = auth.uid()
$$;

ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_my_team_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select team_id from public.profiles where id = auth.uid()
$$;

ALTER FUNCTION "public"."get_my_team_id"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

-- =============================================
-- AUCTION LOG (for 10-move undo + live feed)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."auction_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."auction_log" OWNER TO "postgres";

-- =============================================
-- AUCTION LOTS (one per player being auctioned)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."auction_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "phase" "text" DEFAULT 'pending'::"text" NOT NULL,
    "timer_started_at" timestamp with time zone,
    "current_bid" numeric(5,2),
    "current_bidder_id" "uuid",
    "bid_start_team_index" integer DEFAULT 0 NOT NULL,
    "winning_team_id" "uuid",
    "winning_bid" numeric(5,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "current_turn_team_id" "uuid",
    CONSTRAINT "auction_lots_phase_check" CHECK (("phase" = ANY (ARRAY['pending'::"text", 'interest'::"text", 'bidding'::"text", 'concluded'::"text"])))
);

ALTER TABLE "public"."auction_lots" OWNER TO "postgres";

-- =============================================
-- AUCTION SNAPSHOTS (point-in-time state)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."auction_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."auction_snapshots" OWNER TO "postgres";

-- =============================================
-- AUCTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."auctions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" DEFAULT 'initial'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "gameweek" integer,
    "current_position_category" "text",
    "auction_order" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "current_bidder_index" integer DEFAULT 0 NOT NULL,
    "free_transfers" integer DEFAULT 2 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "auctions_current_position_category_check" CHECK (("current_position_category" = ANY (ARRAY['GK'::"text", 'DEF'::"text", 'MID'::"text", 'FWD'::"text"]))),
    CONSTRAINT "auctions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text"]))),
    CONSTRAINT "auctions_type_check" CHECK (("type" = ANY (ARRAY['initial'::"text", 'mini'::"text", 'post_jan'::"text", 'post_summer'::"text"])))
);

ALTER TABLE "public"."auctions" OWNER TO "postgres";

-- =============================================
-- BIDS (interest declarations + bid amounts)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."bids" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lot_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "amount" numeric(5,2),
    "is_interested" boolean DEFAULT true NOT NULL,
    "is_folded" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."bids" OWNER TO "postgres";

-- =============================================
-- CHAT KICKS (moderation)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."chat_kicks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guest_name" "text" NOT NULL,
    "kicked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."chat_kicks" OWNER TO "postgres";

-- =============================================
-- CHAT MESSAGES
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid",
    "user_id" "uuid",
    "author_name" "text" NOT NULL,
    "is_guest" boolean DEFAULT false NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_message_check" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 500)))
);

ALTER TABLE "public"."chat_messages" OWNER TO "postgres";

-- =============================================
-- GAMEWEEK POINTS (scoring)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."gameweek_points" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "gameweek" integer NOT NULL,
    "player_id" integer,
    "points" integer DEFAULT 0 NOT NULL,
    "was_subbed_in" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."gameweek_points" OWNER TO "postgres";

-- =============================================
-- PLAYERS (synced from FPL API)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" integer NOT NULL,
    "first_name" "text" NOT NULL,
    "second_name" "text" NOT NULL,
    "web_name" "text" NOT NULL,
    "position" "text" NOT NULL,
    "fpl_team" "text" DEFAULT ''::"text" NOT NULL,
    "fpl_team_short" "text" DEFAULT ''::"text" NOT NULL,
    "selected_by_percent" numeric(5,2) DEFAULT 0 NOT NULL,
    "total_points" integer DEFAULT 0 NOT NULL,
    "goals_scored" integer DEFAULT 0 NOT NULL,
    "assists" integer DEFAULT 0 NOT NULL,
    "clean_sheets" integer DEFAULT 0 NOT NULL,
    "bonus" integer DEFAULT 0 NOT NULL,
    "yellow_cards" integer DEFAULT 0 NOT NULL,
    "red_cards" integer DEFAULT 0 NOT NULL,
    "minutes" integer DEFAULT 0 NOT NULL,
    "base_price" numeric(5,2) DEFAULT 1.00 NOT NULL,
    "fpl_cost" numeric(5,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'a'::"text" NOT NULL,
    "news" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "players_position_check" CHECK (("position" = ANY (ARRAY['GK'::"text", 'DEF'::"text", 'MID'::"text", 'FWD'::"text"])))
);

ALTER TABLE "public"."players" OWNER TO "postgres";

-- =============================================
-- PROFILES (role-based auth on top of Supabase Auth)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'team'::"text" NOT NULL,
    "username" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "team_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'auction_master'::"text", 'team'::"text", 'guest'::"text"])))
);

ALTER TABLE "public"."profiles" OWNER TO "postgres";

-- =============================================
-- ROSTER ENTRIES
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."roster_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "slot_type" "text" DEFAULT 'starting'::"text" NOT NULL,
    "bench_order" integer,
    "is_captain" boolean DEFAULT false NOT NULL,
    "is_vice_captain" boolean DEFAULT false NOT NULL,
    "base_price" numeric(5,2) NOT NULL,
    "purchased_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "roster_entries_slot_type_check" CHECK (("slot_type" = ANY (ARRAY['starting'::"text", 'bench'::"text", 'dropped'::"text"])))
);

ALTER TABLE "public"."roster_entries" OWNER TO "postgres";

-- =============================================
-- TEAM DROPS (drop staging for each auction)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."team_drops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "drop_price" numeric(5,2),
    "status" "text" DEFAULT 'staged'::"text" NOT NULL,
    "dropped_post_january" boolean DEFAULT false NOT NULL,
    "penalty_gameweek" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dropped_post_summer" boolean DEFAULT false NOT NULL,
    CONSTRAINT "team_drops_status_check" CHECK (("status" = ANY (ARRAY['staged'::"text", 'locked'::"text", 'cancelled'::"text"])))
);

ALTER TABLE "public"."team_drops" OWNER TO "postgres";

-- =============================================
-- TEAM DROP TRANSFER RECORDS (free transfer tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."team_transfer_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "free_transfers_base" integer DEFAULT 2 NOT NULL,
    "free_transfers_carryover" integer DEFAULT 0 NOT NULL,
    "transfers_used" integer DEFAULT 0 NOT NULL,
    "excess_drops" integer DEFAULT 0 NOT NULL,
    "points_penalty" integer DEFAULT 0 NOT NULL
);

ALTER TABLE "public"."team_transfer_records" OWNER TO "postgres";

-- =============================================
-- TEAMS
-- =============================================
CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "display_name" "text" NOT NULL,
    "short_name" "text" NOT NULL,
    "budget" numeric(6,2) DEFAULT 100.00 NOT NULL,
    "color" "text" DEFAULT '#10b981'::"text" NOT NULL,
    "auction_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."teams" OWNER TO "postgres";

ALTER TABLE ONLY "public"."auction_log"
    ADD CONSTRAINT "auction_log_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."auction_lots"
    ADD CONSTRAINT "auction_lots_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."auction_snapshots"
    ADD CONSTRAINT "auction_snapshots_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."bids"
    ADD CONSTRAINT "bids_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."chat_kicks"
    ADD CONSTRAINT "chat_kicks_guest_name_key" UNIQUE ("guest_name");

ALTER TABLE ONLY "public"."chat_kicks"
    ADD CONSTRAINT "chat_kicks_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gameweek_points"
    ADD CONSTRAINT "gameweek_points_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");

ALTER TABLE ONLY "public"."roster_entries"
    ADD CONSTRAINT "roster_entries_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."team_drops"
    ADD CONSTRAINT "team_drops_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."team_transfer_records"
    ADD CONSTRAINT "team_transfer_records_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."roster_entries"
    ADD CONSTRAINT "unique_active_player_per_team" UNIQUE ("player_id", "team_id");

ALTER TABLE ONLY "public"."auction_snapshots"
    ADD CONSTRAINT "unique_auction_snapshot" UNIQUE ("auction_id");

ALTER TABLE ONLY "public"."bids"
    ADD CONSTRAINT "unique_bid_per_team_per_lot" UNIQUE ("lot_id", "team_id");

ALTER TABLE ONLY "public"."team_drops"
    ADD CONSTRAINT "unique_drop_per_player_per_auction" UNIQUE ("player_id", "auction_id");

ALTER TABLE ONLY "public"."team_transfer_records"
    ADD CONSTRAINT "unique_team_auction" UNIQUE ("team_id", "auction_id");

CREATE INDEX "chat_messages_auction_id_created_at_idx" ON "public"."chat_messages" USING "btree" ("auction_id", "created_at");

CREATE INDEX "chat_messages_created_at_idx" ON "public"."chat_messages" USING "btree" ("created_at") WHERE ("auction_id" IS NULL);

CREATE UNIQUE INDEX "unique_player_team_gw" ON "public"."gameweek_points" USING "btree" ("team_id", "gameweek", "player_id") WHERE ("player_id" IS NOT NULL);

ALTER TABLE ONLY "public"."auction_log"
    ADD CONSTRAINT "auction_log_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."auction_lots"
    ADD CONSTRAINT "auction_lots_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."auction_lots"
    ADD CONSTRAINT "auction_lots_current_bidder_id_fkey" FOREIGN KEY ("current_bidder_id") REFERENCES "public"."teams"("id");

ALTER TABLE ONLY "public"."auction_lots"
    ADD CONSTRAINT "auction_lots_current_turn_team_id_fkey" FOREIGN KEY ("current_turn_team_id") REFERENCES "public"."teams"("id");

ALTER TABLE ONLY "public"."auction_lots"
    ADD CONSTRAINT "auction_lots_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");

ALTER TABLE ONLY "public"."auction_lots"
    ADD CONSTRAINT "auction_lots_winning_team_id_fkey" FOREIGN KEY ("winning_team_id") REFERENCES "public"."teams"("id");

ALTER TABLE ONLY "public"."auction_snapshots"
    ADD CONSTRAINT "auction_snapshots_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."bids"
    ADD CONSTRAINT "bids_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."auction_lots"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."bids"
    ADD CONSTRAINT "bids_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."gameweek_points"
    ADD CONSTRAINT "gameweek_points_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");

ALTER TABLE ONLY "public"."gameweek_points"
    ADD CONSTRAINT "gameweek_points_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."roster_entries"
    ADD CONSTRAINT "roster_entries_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");

ALTER TABLE ONLY "public"."roster_entries"
    ADD CONSTRAINT "roster_entries_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."team_drops"
    ADD CONSTRAINT "team_drops_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id");

ALTER TABLE ONLY "public"."team_drops"
    ADD CONSTRAINT "team_drops_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id");

ALTER TABLE ONLY "public"."team_drops"
    ADD CONSTRAINT "team_drops_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");

ALTER TABLE ONLY "public"."team_transfer_records"
    ADD CONSTRAINT "team_transfer_records_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id");

ALTER TABLE ONLY "public"."team_transfer_records"
    ADD CONSTRAINT "team_transfer_records_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");

CREATE POLICY "AM read snapshots" ON "public"."auction_snapshots" FOR SELECT TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'auction_master'::"text"])));

CREATE POLICY "AM write auctions" ON "public"."auctions" TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'auction_master'::"text"])));

CREATE POLICY "AM write drops lock" ON "public"."team_drops" FOR UPDATE TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'auction_master'::"text"])));

CREATE POLICY "AM write gw points" ON "public"."gameweek_points" TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'auction_master'::"text"])));

CREATE POLICY "AM write log" ON "public"."auction_log" TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'auction_master'::"text"])));

CREATE POLICY "AM write lots" ON "public"."auction_lots" TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'auction_master'::"text"])));

CREATE POLICY "AM write transfers" ON "public"."team_transfer_records" TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'auction_master'::"text"])));

CREATE POLICY "Admin full access snapshots" ON "public"."auction_snapshots" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write auctions" ON "public"."auctions" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write bids" ON "public"."bids" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write drops" ON "public"."team_drops" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write gw points" ON "public"."gameweek_points" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write log" ON "public"."auction_log" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write lots" ON "public"."auction_lots" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write players" ON "public"."players" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write profiles" ON "public"."profiles" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write roster" ON "public"."roster_entries" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write teams" ON "public"."teams" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Admin full write transfers" ON "public"."team_transfer_records" TO "authenticated" USING (("public"."get_my_role"() = 'admin'::"text"));

CREATE POLICY "Anyone can read auctions" ON "public"."auctions" FOR SELECT USING (true);

CREATE POLICY "Anyone can read bids" ON "public"."bids" FOR SELECT USING (true);

CREATE POLICY "Anyone can read chat" ON "public"."chat_messages" FOR SELECT USING (true);

CREATE POLICY "Anyone can read drops" ON "public"."team_drops" FOR SELECT USING (true);

CREATE POLICY "Anyone can read gw points" ON "public"."gameweek_points" FOR SELECT USING (true);

CREATE POLICY "Anyone can read kicks" ON "public"."chat_kicks" FOR SELECT USING (true);

CREATE POLICY "Anyone can read log" ON "public"."auction_log" FOR SELECT USING (true);

CREATE POLICY "Anyone can read lots" ON "public"."auction_lots" FOR SELECT USING (true);

CREATE POLICY "Anyone can read players" ON "public"."players" FOR SELECT USING (true);

CREATE POLICY "Anyone can read profiles" ON "public"."profiles" FOR SELECT USING (true);

CREATE POLICY "Anyone can read roster" ON "public"."roster_entries" FOR SELECT USING (true);

CREATE POLICY "Anyone can read teams" ON "public"."teams" FOR SELECT USING (true);

CREATE POLICY "Anyone can read transfers" ON "public"."team_transfer_records" FOR SELECT USING (true);

CREATE POLICY "Authenticated users can delete own messages" ON "public"."chat_messages" FOR DELETE USING (("auth"."uid"() = "user_id"));

CREATE POLICY "Service role syncs players" ON "public"."players" TO "service_role" USING (true);

CREATE POLICY "Team stages own drops" ON "public"."team_drops" FOR INSERT TO "authenticated" WITH CHECK ((("team_id" = "public"."get_my_team_id"()) AND ("status" = 'staged'::"text")));

CREATE POLICY "Team updates own bids" ON "public"."bids" FOR UPDATE TO "authenticated" USING (("team_id" = "public"."get_my_team_id"()));

CREATE POLICY "Team updates own display_name" ON "public"."teams" FOR UPDATE TO "authenticated" USING (("id" = "public"."get_my_team_id"())) WITH CHECK (("id" = "public"."get_my_team_id"()));

CREATE POLICY "Team updates own staged drops" ON "public"."team_drops" FOR UPDATE TO "authenticated" USING ((("team_id" = "public"."get_my_team_id"()) AND ("status" = 'staged'::"text")));

CREATE POLICY "Team writes own bids" ON "public"."bids" FOR INSERT TO "authenticated" WITH CHECK (("team_id" = "public"."get_my_team_id"()));

CREATE POLICY "Team writes own roster" ON "public"."roster_entries" TO "authenticated" USING (("team_id" = "public"."get_my_team_id"()));

-- Intentionally removed: client-side UPDATE policy was too broad (allowed updating role/team_id).
-- All profile mutations go through server-side API routes using the service-role client.

ALTER TABLE "public"."auction_log" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."auction_lots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."auction_snapshots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."auctions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."bids" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."chat_kicks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."gameweek_points" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."roster_entries" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."team_drops" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."team_transfer_records" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


-- =============================================
-- REALTIME PUBLICATIONS
-- =============================================
ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."auction_log";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."auction_lots";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bids";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_kicks";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_messages";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."roster_entries";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."teams";


-- =============================================
-- ROLE PRIVILEGES & GRANTS
-- =============================================
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."auction_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."auction_log" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_log" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."auction_lots" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."auction_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_lots" TO "service_role";

GRANT ALL ON TABLE "public"."auction_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."auction_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_snapshots" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."auctions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."auctions" TO "authenticated";
GRANT ALL ON TABLE "public"."auctions" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bids" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bids" TO "authenticated";
GRANT ALL ON TABLE "public"."bids" TO "service_role";

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chat_kicks" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chat_kicks" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chat_kicks" TO "service_role";

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chat_messages" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chat_messages" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."chat_messages" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gameweek_points" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gameweek_points" TO "authenticated";
GRANT ALL ON TABLE "public"."gameweek_points" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."players" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."players" TO "authenticated";
GRANT ALL ON TABLE "public"."players" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roster_entries" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roster_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."roster_entries" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_drops" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_drops" TO "authenticated";
GRANT ALL ON TABLE "public"."team_drops" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_transfer_records" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."team_transfer_records" TO "authenticated";
GRANT ALL ON TABLE "public"."team_transfer_records" TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."teams" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";

-- ── Club cap trigger ─────────────────────────────────────────────────────────
-- Backstop: blocks any insert into roster_entries that would give a team
-- more than 3 players from the same FPL club (slot_type starting or bench).

CREATE OR REPLACE FUNCTION "public"."check_club_cap"()
RETURNS trigger AS $$
DECLARE
  club_name text;
  club_count integer;
BEGIN
  SELECT fpl_team INTO club_name FROM public.players WHERE id = NEW.player_id;

  IF NEW.slot_type IN ('starting', 'bench') THEN
    SELECT COUNT(*) INTO club_count
    FROM public.roster_entries re
    JOIN public.players p ON p.id = re.player_id
    WHERE re.team_id = NEW.team_id
      AND re.slot_type IN ('starting', 'bench')
      AND p.fpl_team = club_name;

    IF club_count >= 3 THEN
      RAISE EXCEPTION 'Club cap exceeded: team already has 3 players from %', club_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "enforce_club_cap"
  BEFORE INSERT ON "public"."roster_entries"
  FOR EACH ROW EXECUTE FUNCTION "public"."check_club_cap"();

GRANT EXECUTE ON FUNCTION "public"."check_club_cap"() TO "authenticated", "anon", "service_role";

-- ── Profile field protection trigger ────────────────────────────────────────
-- Backstop: blocks any UPDATE that attempts to change role or team_id on profiles,
-- regardless of how the request is made. Defense-in-depth alongside the dropped RLS policy.

CREATE OR REPLACE FUNCTION "public"."protect_profile_fields"()
RETURNS trigger AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'You cannot change your own role.';
  END IF;
  IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    RAISE EXCEPTION 'You cannot change your own team assignment.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "enforce_profile_security"
  BEFORE UPDATE ON "public"."profiles"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_profile_fields"();

GRANT EXECUTE ON FUNCTION "public"."protect_profile_fields"() TO "authenticated", "anon", "service_role";

