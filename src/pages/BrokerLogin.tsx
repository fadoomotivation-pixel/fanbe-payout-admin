import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'

// Broker login screen.  Brokers know their phone number; nobody remembers a synthetic
// email like auto-5c943240@example.com.  The form accepts EITHER a phone number or an
// email -- if the input has an @ we treat it as an email, otherwise we call the
// broker_email_for_phone RPC to resolve the phone to the underlying auth email, then
// sign in via Supabase Auth with that email + the password the broker typed.
export default function BrokerLogin() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const id = identifier.trim()
    if (!id) { toast.error('Please enter your phone number or email.'); return }
    if (!password) { toast.error('Please enter your password.'); return }
    setLoading(true)
    try {
      let email: string | null = null
      if (id.includes('@')) {
        email = id.toLowerCase()
      } else {
        // Phone-based login: resolve via the SECURITY DEFINER RPC.  This bypasses RLS to
        // read brokers.email by phone -- the function only returns a result when exactly
        // one active broker matches, so it can't be used to enumerate the directory.
        const { data: resolved } = await supabase.rpc('broker_email_for_phone', { p_phone: id })
        email = (resolved as string | null) || null
      }
      if (!email) {
        toast.error("We couldn't find a broker with that phone number.  Try your full email or ask admin to check your phone is correct.")
        setLoading(false); return
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        // Generic copy -- the raw Supabase error gives away whether the email exists.
        toast.error('Phone number or password is wrong.  Please try again.')
        setLoading(false); return
      }
      const { data: broker } = await supabase.from('brokers').select('id').eq('auth_user_id', data.user?.id).maybeSingle()
      if (!broker) {
        await supabase.auth.signOut()
        toast.error('No broker linked to this login.  Please contact admin.')
        setLoading(false); return
      }
      toast.success('Welcome!')
      navigate('/broker/dashboard')
    } finally {
      setLoading(false)
    }
  }

  const looksLikePhone = identifier.length > 0 && !identifier.includes('@')

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-900 to-teal-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">B</div>
          <h1 className="text-2xl font-bold text-gray-900">Broker Portal</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in with your phone number</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="username"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              required
              placeholder="e.g. 9876543210"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              {looksLikePhone
                ? 'Just type your 10-digit phone number — country code optional.'
                : 'You can also sign in with your full email if you prefer.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-700 hover:text-emerald-900 px-1.5"
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <div className="text-center mt-6 pt-6 border-t border-gray-100">
          <Link to="/login" className="text-xs text-gray-500 hover:underline">← Back to admin login</Link>
        </div>
      </div>
    </div>
  )
}
