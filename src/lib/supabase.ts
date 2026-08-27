/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

// There used to be two of these — supabase.js and supabase.ts. Vite resolves `.js` before
// `.ts`, so `@/lib/supabase` silently picked the .js one, which had no fallback values,
// while the .ts one holding them was dead code nobody ran.
//
// That is what white-screened the APK. On Vercel the env vars are set, so the web app was
// fine; the GitHub Actions build had no secrets, both values came back undefined, and
// createClient() threw at module load — before React mounted, so there was nothing to
// render and nothing to report. Just a blank screen.
//
// One file now. The fallbacks are the project's own public anon key, which is shipped in
// the client bundle regardless — RLS is what protects the data, not the secrecy of this
// key. Setting VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY still overrides them.
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://mfgjzkaabyltscgrkhdz.supabase.co'
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mZ2p6a2FhYnlsdHNjZ3JraGR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDAzNjQsImV4cCI6MjA4NjkxNjM2NH0.V6uWBH72rgp0UEFdB9aT8qrG4YFYhnERWZO1t976_tM'

// If a build ever ships without usable config again, say so on the screen instead of
// dying silently at import time. A blank app tells whoever installed it nothing.
if (!URL || !KEY) {
  const msg = 'App is not configured: the Supabase URL or key is missing from this build.'
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML =
      `<div style="font:15px/1.5 system-ui;padding:28px;color:#1D1D1F">${msg}</div>`
  })
  throw new Error(msg)
}

export const supabase = createClient(URL, KEY)
