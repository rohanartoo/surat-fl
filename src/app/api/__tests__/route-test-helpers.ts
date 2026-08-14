// Extends the makeQueryChain/makeSupabase pattern already established in
// src/lib/__tests__/scoring.test.ts (a thenable chain object where every
// filter method just re-returns itself, resolving to fixed data configured
// per table) with what route handlers additionally need: .single()/
// .maybeSingle(), .insert()/.update()/.delete()/.upsert() as valid chain
// starting points, and .rpc() with call recording.
//
// Data is keyed by table name, not by the specific filters applied in a
// given call — the same simplification scoring.test.ts already makes. A
// handler that queries the same table more than once with different
// expected shapes (e.g. reads a single row, then a helper it calls reads a
// list from the same table) can configure an ARRAY of responses for that
// table — each successive .from(table) call consumes the next entry,
// holding on the last one once exhausted.

export interface MockTableConfig {
  data?: unknown
  error?: unknown
  /** For `.select(..., { count: "exact" })` calls — e.g. handleStartBidding's
   * solo-win roster-fullness check destructures `{ count }`, not `{ data }`. */
  count?: number
}

export type MockTableEntry = MockTableConfig | MockTableConfig[]

export interface MockRpcConfig {
  data?: unknown
  error?: unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chain = Promise<{ data: unknown; error: unknown; count?: number }> & Record<string, (...args: unknown[]) => any>

const PASSTHROUGH_METHODS = [
  "eq", "neq", "not", "in", "limit", "order", "gt", "lt", "gte", "lte",
  "filter", "range", "single", "maybeSingle",
]

function makeChain(data: unknown, error: unknown, count?: number): Chain {
  const chain = Promise.resolve({ data, error, count }) as Chain
  for (const method of PASSTHROUGH_METHODS) {
    chain[method] = () => makeChain(data, error, count)
  }
  return chain
}

export interface MockSupabase {
  from: (table: string) => {
    select: (...args: unknown[]) => Chain
    insert: (...args: unknown[]) => Chain
    update: (...args: unknown[]) => Chain
    delete: (...args: unknown[]) => Chain
    upsert: (...args: unknown[]) => Chain
  }
  rpc: (name: string, args?: unknown) => Chain
  rpcCalls: { name: string; args: unknown }[]
}

export function createMockSupabase(config: {
  tables?: Record<string, MockTableEntry>
  rpcs?: Record<string, MockRpcConfig>
} = {}): MockSupabase {
  const tables = config.tables ?? {}
  const rpcs = config.rpcs ?? {}
  const rpcCalls: { name: string; args: unknown }[] = []
  const callCounts: Record<string, number> = {}

  const from: MockSupabase["from"] = (table: string) => {
    const entry = tables[table]
    const sequence = Array.isArray(entry) ? entry : entry ? [entry] : []
    const idx = callCounts[table] ?? 0
    callCounts[table] = idx + 1
    const { data = null, error = null, count } = sequence[Math.min(idx, sequence.length - 1)] ?? {}
    const startChain = () => makeChain(data, error, count)
    return { select: startChain, insert: startChain, update: startChain, delete: startChain, upsert: startChain }
  }

  const rpc: MockSupabase["rpc"] = (name, args) => {
    rpcCalls.push({ name, args })
    const { data = null, error = null } = rpcs[name] ?? {}
    return makeChain(data, error)
  }

  return { from, rpc, rpcCalls }
}
