// Edge function: create-broker-login
//
// Creates a Supabase auth user for a broker and links auth_user_id on the brokers row.
// Caller must be an authenticated admin (an active app_users row).
//
// The password rule lives HERE and nowhere else: default = the broker's phone digits, so
// admin can tell a broker "your login is your ID number, your password is your mobile
// number" without anything to write down.  The Brokers page used to compute the same
// string before calling, which meant two places to change if the rule ever moves; it now
// just omits `password` and lets this decide.  An explicit `password` still wins, which is
// what the "set password" box in the broker edit form sends.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length]
  return out
}

function phoneDigits(s: string | null | undefined): string {
  return (s || '').replace(/[^0-9]/g, '')
}

// Find an existing auth user by email.  listUsers is paginated, and stopping at the first
// page would mean "not found" once the project passes that many users -- which would then
// fall through to an error instead of linking the account that already exists.
async function findAuthUserByEmail(adminClient: any, email: string) {
  const target = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data } = await adminClient.auth.admin.listUsers({ page, perPage: 200 })
    const users = data?.users || []
    const hit = users.find((u: any) => (u.email || '').toLowerCase() === target)
    if (hit) return hit
    if (users.length < 200) return null
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')   return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401)
    const callerJwt = authHeader.replace('Bearer ', '')

    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userResp, error: userErr } = await callerClient.auth.getUser(callerJwt)
    if (userErr || !userResp?.user) return json({ error: 'Invalid auth' }, 401)

    const adminClient = createClient(url, serviceKey)

    const { data: appUser } = await adminClient
      .from('app_users')
      .select('id, active')
      .eq('auth_user_id', userResp.user.id)
      .maybeSingle()
    if (!appUser?.active) return json({ error: 'Admin access required' }, 403)

    const body = await req.json().catch(() => ({}))
    const broker_id = body.broker_id as string
    const incomingPassword = (body.password as string | undefined)?.trim()
    if (!broker_id) return json({ error: 'broker_id required' }, 400)

    const { data: broker, error: brokerErr } = await adminClient
      .from('brokers')
      .select('id, name, email, phone, broker_id, auth_user_id')
      .eq('id', broker_id)
      .maybeSingle()
    if (brokerErr || !broker) return json({ error: 'Broker not found' }, 404)
    if (!broker.email) return json({ error: 'Broker has no email - add one before creating login' }, 400)
    if (broker.auth_user_id) {
      return json({ error: 'Broker already has a linked login. Use reset-broker-password if needed.', auth_user_id: broker.auth_user_id }, 409)
    }

    // A staff member who also has a broker row (admin@fanbegroup.com is one) must not be
    // given a broker login on the same email: the "already registered" branch below would
    // otherwise link the STAFF auth user to the broker row, and from then on that staff
    // password would open the broker portal as well.  Two roles, two accounts.
    // ilike treats % and _ as wildcards, so they are escaped -- this is an exact,
    // case-insensitive comparison, not a pattern match.
    const { data: staffRows } = await adminClient
      .from('app_users')
      .select('id')
      .ilike('email', broker.email.replace(/([%_\\])/g, '\\$1'))
      .limit(1)
    const staffRow = staffRows?.[0]
    if (staffRow) {
      return json({ error: `${broker.email} is a staff login. Give this broker a different email before creating a broker login.` }, 409)
    }

    // Default password = phone digits.  Falls back to a random string only when the broker
    // has no usable phone; an explicit password from the caller overrides both.
    const phonePwd = phoneDigits(broker.phone)
    const password = (incomingPassword && incomingPassword.length >= 6)
      ? incomingPassword
      : (phonePwd.length >= 6 ? phonePwd : randomPassword(10))

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: broker.email,
      password,
      email_confirm: true,
      user_metadata: { broker_id: broker.broker_id, name: broker.name, role: 'broker' },
    })
    if (createErr || !created?.user) {
      const msg = (createErr?.message || '').toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists')) {
        const existing = await findAuthUserByEmail(adminClient, broker.email)
        if (existing) {
          await adminClient.from('brokers').update({ auth_user_id: existing.id }).eq('id', broker.id)
          return json({
            ok: true, reused: true, auth_user_id: existing.id, email: broker.email, password: null,
            message: 'User already existed in auth.users - linked to broker. Password unchanged.',
          })
        }
      }
      return json({ error: createErr?.message || 'Failed to create user' }, 500)
    }

    const { error: linkErr } = await adminClient
      .from('brokers')
      .update({ auth_user_id: created.user.id })
      .eq('id', broker.id)
    if (linkErr) {
      return json({ error: 'User created but link failed: ' + linkErr.message, auth_user_id: created.user.id }, 500)
    }

    return json({
      ok: true,
      reused: false,
      auth_user_id: created.user.id,
      email: broker.email,
      password,
      login_id: broker.broker_id,
      message: 'Broker login created. They sign in at /broker/login with their broker ID and this password.',
    })
  } catch (e: any) {
    return json({ error: e?.message || 'Internal error' }, 500)
  }
})
