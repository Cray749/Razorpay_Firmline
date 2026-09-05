// lib/supabase/client.ts — single source of truth for the Supabase connection.
// Lazy-initialized so importing this module never throws before env vars are
// configured (matters for running unit tests / building rule logic before
// Phase 0's credentials land — see docs/BLOCKERS.md).
//
// Accepts either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Supabase's current key
// system, `sb_publishable_...`) or the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY
// (a JWT, `eyJ...`) — newer Supabase projects only issue the former from the
// dashboard, older ones still show the latter. Functionally interchangeable:
// both are the public, RLS-governed key meant for client-side use.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
let warnedOnce = false;

function getPublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && getPublicKey());
}

/**
 * Returns a shared Supabase client, or null if the env vars aren't set yet.
 * Callers (audit log, seed script, API routes) must handle the null case —
 * this project has no separate "offline mode" flag, the absence of
 * configuration IS the offline mode.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached) return cached;
  if (!isSupabaseConfigured()) {
    if (!warnedOnce) {
      console.warn(
        "[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) not set — Supabase-backed features are disabled until .env.local is configured."
      );
      warnedOnce = true;
    }
    return null;
  }
  cached = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getPublicKey()!);
  return cached;
}
