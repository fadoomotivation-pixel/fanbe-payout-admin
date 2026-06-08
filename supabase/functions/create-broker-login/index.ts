// Edge function: create-broker-login
// Creates a Supabase auth user for a broker and links auth_user_id on the brokers row.
// Caller must be an authenticated admin (linked to an active app_users row).

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
    const broker_id = body.broker_id as string
    const password = (body.password as string | undefined) || randomPassword(10)
    if (!broker_id) {
      return new Response(JSON.stringify({ error: 'broker_id required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { data: broker, error: brokerErr } = await adminClient
      .from('brokers')
      .select('id, name, email, broker_id, auth_user_id')
      .eq('id', broker_id)
      .maybeSingle()
    if (brokerErr || !broker) {
      return new Response(JSON.stringify({ error: 'Broker not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    if (!broker.email) {
      return new Response(JSON.stringify({ error: 'Broker has no email - add one before creating login' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    if (broker.auth_user_id) {
      return new Response(JSON.stringify({ error: 'Broker already has a linked login. Use reset-broker-password if needed.', auth_user_id: broker.auth_user_id }), { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: broker.email,
      password,
      email_confirm: true,
      user_metadata: { broker_id: broker.broker_id, name: broker.name, role: 'broker' },
    })
    if (createErr || !created?.user) {
      const msg = createErr?.message || ''
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
        const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 })
        const existing = list?.users?.find((u: any) => (u.email || '').toLowerCase() === broker.email.toLowerCase())
        if (existing) {
          await adminClient.from('brokers').update({ auth_user_id: existing.id }).eq('id', broker.id)
          return new Response(JSON.stringify({ ok: true, reused: true, auth_user_id: existing.id, email: broker.email, password: null, message: 'User already existed in auth.users - linked to broker. Password unchanged.' }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
        }
      }
      return new Response(JSON.stringify({ error: createErr?.message || 'Failed to create user' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const { error: linkErr } = await adminClient
      .from('brokers')
      .update({ auth_user_id: created.user.id })
      .eq('id', broker.id)
    if (linkErr) {
      return new Response(JSON.stringify({ error: 'User created but link failed: ' + linkErr.message, auth_user_id: created.user.id }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({
      ok: true,
      reused: false,
      auth_user_id: created.user.id,
      email: broker.email,
      password,
      message: 'Broker login created. Share the email + password with the broker. They sign in at /broker/login.',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Internal error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
