import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * CLAUDE.md and AGENTS.md are loaded into every agent session as project
 * instructions, so a stale claim in them misleads silently — nothing else in
 * the toolchain reads them, and no amount of tsc/lint/build will notice when
 * a file they point at is renamed or deleted.
 *
 * This can only mechanise the objectively checkable part: that every repo
 * path and env var those files name still exists. Prose can still go out of
 * date (see the "Maintaining this file" section in CLAUDE.md for the parts
 * that need a human/agent to keep honest) — but a dangling `src/lib/foo.ts`
 * is the most common drift and is worth failing CI over.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

const AGENT_DOCS = ["CLAUDE.md", "AGENTS.md"]

/** Backtick-quoted tokens that end in a source-file extension. `[action]`
 *  style dynamic segments are real directory names, so they are kept as-is. */
const PATH_IN_BACKTICKS = /`([A-Za-z0-9_@./[\]-]+\.(?:ts|tsx|md|sql|json|mjs|css|yml))`/g

/** SCREAMING_SNAKE tokens in backticks — env vars the docs promise exist. */
const ENV_IN_BACKTICKS = /`([A-Z][A-Z0-9_]{3,})`/g

function read(doc: string) {
  return readFileSync(resolve(REPO, doc), "utf8")
}

describe("agent instruction files", () => {
  for (const doc of AGENT_DOCS) {
    it(`${doc}: every repo path it names exists`, () => {
      const text = read(doc)
      const missing: string[] = []

      for (const [, raw] of text.matchAll(PATH_IN_BACKTICKS)) {
        // `@AGENTS.md` is an import directive, not a path literal.
        const path = raw.replace(/^@/, "")
        // Glob-ish references (supabase/migrations/*.sql) aren't checkable.
        if (path.includes("*")) continue
        if (!existsSync(resolve(REPO, path))) missing.push(raw)
      }

      expect(missing, `${doc} points at files that no longer exist`).toEqual([])
    })
  }

  it("CLAUDE.md: every env var it names is referenced in the codebase", () => {
    const text = read("CLAUDE.md")
    // Only vars the docs treat as configuration; these are the ones whose
    // rename would silently break a deploy while CI stayed green.
    const known = new Set([
      "SYNC_SECRET",
      "CRON_SECRET",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_GUEST_PASSWORD",
    ])
    const named = [...text.matchAll(ENV_IN_BACKTICKS)]
      .map(m => m[1])
      .filter(v => known.has(v))

    expect(named.length, "expected CLAUDE.md to still document the sync secrets").toBeGreaterThan(0)

    // CRON_SECRET is the one that isn't read by our own code (Vercel injects
    // it), so it is documented rather than grep-able — exempt it explicitly.
    const unreferenced = named.filter(v => v !== "CRON_SECRET" && !srcMentions(v))
    expect(unreferenced, "CLAUDE.md names env vars nothing in src/ reads").toEqual([])
  })

  it("CLAUDE.md: still declares the season live, not pre-season", () => {
    // Only the instructions themselves, not the trailing "Maintaining this
    // file" section — that section quotes the stale phrasing as a worked
    // example of drift, and would otherwise trip its own guard.
    const instructions = read("CLAUDE.md").split("# Maintaining this file")[0]

    // Guards the specific staleness found on 2026-08-30: the file claimed
    // pre-season testing while production held two scored gameweeks. If the
    // league genuinely returns to pre-season, change this assertion
    // deliberately rather than letting the claim rot unnoticed.
    expect(instructions).not.toMatch(/in pre-season testing/i)
  })
})

function srcMentions(token: string): boolean {
  // Cheap targeted scan — the env vars all appear in a handful of lib/route
  // files, so a full recursive walk isn't warranted.
  const candidates = [
    "src/lib/auth.ts",
    "src/lib/supabase/server.ts",
    "src/lib/supabase/client.ts",
    "src/app/api/scoring/cron/route.ts",
  ]
  return candidates.some(f => {
    const p = resolve(REPO, f)
    return existsSync(p) && readFileSync(p, "utf8").includes(token)
  })
}
