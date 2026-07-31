/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

// Read connection details from .env (see .env.example for the variable names).  No
// fallback values are baked into the source — if these env vars are missing the build
// will fail loudly, which is exactly what we want, instead of silently connecting to
// the wrong project.
const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!URL || !KEY) {
  throw new Error(
    'Missing Supabase environment variables.  Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase project (Project Settings -> API).'
  )
}

export const supabase = createClient(URL, KEY)
