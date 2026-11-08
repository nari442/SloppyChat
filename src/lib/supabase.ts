import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient(url: string, publishableKey: string) {
  if (!url || !publishableKey) {
    throw new Error('Supabase URL and public publishable key are required.')
  }
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  })
}
