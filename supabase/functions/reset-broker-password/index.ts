// Edge function: reset-broker-password
// Resets the password on an existing broker's Supabase auth user.  Caller must be an
// authenticated admin (linked to an active app_users row).
//
// Supabase stores passwords as bcrypt hashes - there is no way to *see* a broker's
// existing password, only to set a new one.  This function lets admin set that new
// value (or generate a random one) and returns it once so it can be shared with the
// broker.  After this response there's no way to retrieve it again.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length]
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')   return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    const callerJwt = authHeader.replace('Bearer ', '')

    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userResp, error: userErr } = await callerClient.auth.getUser(callerJwt)
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: 'Invalid auth' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const adminClient = createClient(url, serviceKey)

    const { data: appUser } = await adminClient
      .from('app_users')
      .select('id, active')
      .eq('auth_user_id', userResp.user.id)
      .maybeSingle()
    if (!appUser?.active) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const body = await req.json().catch(() => ({}))
    const broker_id = body.broker_id as string | undefined
    const incomingPassword = (body.password as string | undefined)?.trim()
    const password = incomingPassword && incomingPassword.length >= 6 ? incomingPassword : randomPassword(10)
    if (!broker_id) {
      return new Response(JSON.stringify({ error: 'broker_id required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    if (incomingPassword && incomingPassword.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { data: broker, error: brokerErr } = await adminClient
      .from('brokers')
      .select('id, name, email, broker_id, auth_user_id')
      .eq('id', broker_id)
      .maybeSingle()
    if (brokerErr || !broker) {
      return new Response(JSON.stringify({ error: 'Broker not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    if (!broker.auth_user_id) {
      return new Response(JSON.stringify({ error: 'This broker has no login yet - use create-broker-login first.' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { error: updErr } = await adminClient.auth.admin.updateUserById(broker.auth_user_id, { password })
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message || 'Password reset failed' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({
      ok: true,
      auth_user_id: broker.auth_user_id,
      email: broker.email,
      password,
      message: 'Password reset. Share the new password with the broker - it will not be visible again.',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Internal error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
