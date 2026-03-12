import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type { SupabaseClient };

/**
 * Create a Supabase client for browser use (widget, client-side admin).
 * Uses the anon key — RLS policies control access.
 */
export function createBrowserClient(): SupabaseClient {
  const url = getEnvVar("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anonKey);
}

/**
 * Create a Supabase client for server use (admin API routes, edge functions).
 * Uses the service role key — bypasses RLS.
 */
export function createServerClient(): SupabaseClient {
  const url = getEnvVar("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey);
}

function getEnvVar(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}
