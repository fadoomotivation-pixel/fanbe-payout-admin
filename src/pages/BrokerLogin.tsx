import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'

// Broker login screen.
//
// Brokers are known by their broker ID -- FNB05120 -- on every paper in the office, and
// nobody remembers a synthetic email like auto-5c943240@example.com.  So the one box
// accepts whatever the broker has to hand: the ID number (5120), the full ID (FNB05120),
// their mobile number, or an email.  broker_email_for_login resolves all four to the
// single email Supabase Auth signs in with.
//
// That resolution deliberately lives in the database, not here: it answers only on an
// exact, unique match, so a wrong guess reveals nothing about who else is on the system.
// A duplicate mobile number (a few brokers share an office landline) resolves to nothing
// on purpose -- those brokers sign in with their ID instead.
export default function BrokerLogin() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const id = identifier.trim()
    if (!id) { toast.error('Please enter your broker ID or mobile number.'); return }
    if (!password) { toast.error('Please enter your password.'); return }
    setLoading(true)
    try {
      // One SECURITY DEFINER RPC handles every form of the ID.  It bypasses RLS to read
      // brokers.email, and answers only when exactly one active broker matches, so it
      // cannot be used to walk the directory.
      const { data: resolved } = await supabase.rpc('broker_email_for_login', { p_login: id })
      const email = (resolved as string | null) || null
      if (!email) {
        toast.error("We couldn't find that broker ID or mobile number. Please check it, or ask admin.")
        setLoading(false); return
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        // Generic copy -- the raw Supabase error gives away whether the email exists.
        toast.error('Broker ID or password is wrong.  Please try again.')
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

  const hint = identifier.includes('@')
    ? 'Signing in with your email address.'
    : 'Your broker ID (for example 5120 or FNB05120) or your 10-digit mobile number.'

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-900 to-teal-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">B</div>
          <h1 className="text-2xl font-bold text-gray-900">Broker Portal</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in with your broker ID</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Broker ID or mobile number</label>
            <input
              type="text"
              inputMode="text"
              autoComplete="username"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              required
              placeholder="e.g. 5120 or FNB05120"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
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
            <p className="text-[11px] text-gray-400 mt-1">
              First time? Your password is your own mobile number. Ask admin to change it after you sign in.
            </p>
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
