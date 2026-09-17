import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Guards the lockdown in 20260917120000_close_team_direct_writes.sql from
// being quietly undone by a later migration. Everything a team does goes
// through service-role API routes; a write policy a team can satisfy, or an
// rpc_* function callable from the browser, lets a team bypass league rules
// (budget, roster, bids) with nothing but devtools and its own session.

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations")
const LOCKDOWN = "20260917120000_close_team_direct_writes.sql"

const later = readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith(".sql") && f > LOCKDOWN)
  .sort()
  .map(file => ({ file, sql: stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")).toLowerCase() }))

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "")
}

/** Pure checks, exported shape kept local so the rules can be tested on fixtures too. */
function violations(sql: string): string[] {
  const found: string[] = []

  for (const m of sql.matchAll(/grant\s+execute\s+on\s+function\s+public\.(rpc_\w+)[^;]*\bto\b([^;]*);/g)) {
    if (/\b(anon|authenticated|public)\b/.test(m[2])) found.push(`grants EXECUTE on ${m[1]} to a browser role`)
  }

  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(rpc_\w+)/g)) {
    const revoke = new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${m[1]}\\b[^;]*from[^;]*\\bpublic\\b`)
    if (!revoke.test(sql)) found.push(`creates ${m[1]} without revoking EXECUTE from public, anon, authenticated`)
  }

  for (const m of sql.matchAll(/create\s+policy\s+"[^"]*"\s+on\s+public\.(bids|roster_entries|team_drops|teams)\b([^;]*);/g)) {
    const body = m[2]
    if (/\bfor\s+(insert|update|delete|all)\b/.test(body) && body.includes("get_my_team_id")) {
      found.push(`adds a team-scoped write policy on ${m[1]}`)
    }
  }

  return found
}

describe("migration security guard", () => {
  it("flags the patterns it exists to catch", () => {
    expect(violations("grant execute on function public.rpc_x(uuid) to authenticated, anon, service_role;")).toHaveLength(1)
    expect(violations("create or replace function public.rpc_x() returns void as $$ begin end $$ language plpgsql;")).toHaveLength(1)
    expect(violations(`create policy "t" on public.teams for update to authenticated using (id = get_my_team_id());`)).toHaveLength(1)
  })

  it("accepts a new rpc that revokes browser access, and admin-only policies", () => {
    expect(violations(`
      create or replace function public.rpc_x() returns void as $$ begin end $$ language plpgsql;
      revoke execute on function public.rpc_x() from public, anon, authenticated;
      grant execute on function public.rpc_x() to service_role;
      create policy "a" on public.teams for all to authenticated using (get_my_role() = 'admin');
    `)).toEqual([])
  })

  it.each(later.length ? later : [{ file: "(no migrations after the lockdown yet)", sql: "" }])(
    "$file keeps team accounts out of direct writes",
    ({ sql }) => {
      expect(violations(sql)).toEqual([])
    },
  )
})
