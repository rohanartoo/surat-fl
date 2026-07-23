// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

/** The auction currently open for bidding/drops (pending = not yet started, active = in progress). */
export async function getCurrentAuction<T = { id: string }>(
  supabase: SupabaseClient,
  select = "id",
): Promise<T | null> {
  const { data } = await supabase
    .from("auctions")
    .select(select)
    .in("status", ["pending", "active"])
    .maybeSingle()
  return (data as T | null) ?? null
}
