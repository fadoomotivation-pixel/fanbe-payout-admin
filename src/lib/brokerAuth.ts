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

  // Which portal does this account belong to?  A broker row linked to the signed-in auth
  // user means the broker portal; anything else is staff.
  const { data: broker } = await supabase
    .from('brokers')
    .select('id')
    .eq('auth_user_id', data.user.id)
    .maybeSingle()

  return { ok: true, isBroker: !!broker }
}
