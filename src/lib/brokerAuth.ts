import { supabase } from '@/lib/supabase'

// One sign-in path for both login screens.
//
// Brokers do not read the URL bar.  They are handed a card that says "ID 5120, password
// your mobile number", they open admin.fanbegroup.com, and they type 5120 into the first
// box they see — which is the admin login.  Sending them away with "please include an @ in
// the email address" is the app's fault, not theirs.
//
// So both screens accept the same four things — broker ID (5120), full ID (FNB05120),
// mobile number, or an email — and this decides where the person actually belongs once
// the password checks out.  Keeping it here rather than in each page means the admin form
// and the broker form can never disagree about what a valid login looks like.

// One shape rather than a discriminated union: this project compiles without
// strictNullChecks, so a union on `ok` does not narrow and every caller would need a cast.
export type LoginOutcome = {
  ok: boolean
  isBroker?: boolean
  reason?: 'unknown-id' | 'wrong-password'
}

export async function signInWithIdOrEmail(identifier: string, password: string): Promise<LoginOutcome> {
  const id = identifier.trim()

  // broker_email_for_login is SECURITY DEFINER: it reads brokers.email past RLS but
  // answers only on a single exact match, so a wrong guess reveals nothing about who else
  // is on the system.  An address with an @ is passed straight through — the password
  // check is what actually decides, and staff sign in with their email.
  const email = id.includes('@')
    ? id.toLowerCase()
    : ((await supabase.rpc('broker_email_for_login', { p_login: id })).data as string | null) || null

  if (!email) return { ok: false, reason: 'unknown-id' }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data?.user) return { ok: false, reason: 'wrong-password' }

  const kind = await accountKind()
  return { ok: true, isBroker: kind === 'broker' }
}

// Which side of the business is the signed-in account on?
//
// 'staff'   — an active app_users row: the office.  The admin panel is theirs.
// 'broker'  — a brokers row linked to this auth user: the broker portal, nothing else.
// 'neither' — signed in, but belongs to no one.  Treated as a broker would be: kept out.
//
// This exists because "is there a session?" was the only question the admin routes asked,
// and every broker now has a login.  A session proves who you are, not what you may open.
export type AccountKind = 'staff' | 'broker' | 'neither' | 'signed-out'

export async function accountKind(): Promise<AccountKind> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'signed-out'

  // Staff is checked first and wins: if the same person somehow holds both rows, the
  // office side is the one they were given deliberately.
  const [{ data: staff }, { data: broker }] = await Promise.all([
    supabase.from('app_users').select('id, active').eq('auth_user_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id').eq('auth_user_id', user.id).maybeSingle(),
  ])

  if (staff?.active) return 'staff'
  if (broker) return 'broker'
  return 'neither'
}
