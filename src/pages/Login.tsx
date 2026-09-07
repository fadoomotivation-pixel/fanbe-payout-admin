import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { signInWithIdOrEmail } from '@/lib/brokerAuth'

// Staff sign in with their email.  Brokers who land here — and they do, because the card
// they were given says "ID 5120" and not "go to /broker/login first" — are signed in with
// their ID and sent to the broker portal instead of being told off about a missing '@'.
export default function Login() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e: any) {
    e.preventDefault()
    if (!identifier.trim()) { toast.error('Please enter your email or broker ID.'); return }
    setLoading(true)
    try {
      const r = await signInWithIdOrEmail(identifier, password)
      if (!r.ok) {
        toast.error(r.reason === 'unknown-id'
          ? "We couldn't find that email or broker ID. Please check it and try again."
          : 'Email/ID or password is wrong. Please try again.')
        return
      }
      toast.success('Welcome back!')
      // A broker has no business on the admin pages, and the admin pages would only show
      // them empty tables anyway — send them where their own numbers are.
      navigate(r.isBroker ? '/broker/dashboard' : '/')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">F</div>
          <h1 className="text-2xl font-bold text-gray-900">Fanbe Group</h1>
          <p className="text-gray-500 text-sm mt-1">Admin Portal</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email or broker ID</label>
            {/* type="text", not "email": the browser refuses to submit "5120" from an
                email field, which is the error the admin was staring at. */}
            <input
              type="text"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="admin@fanbegroup.com or 5120"
            />
            <p className="text-[11px] text-gray-400 mt-1">Brokers: type your ID number (for example 5120) or your mobile number.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <div className="text-center mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-500">Are you a broker?</p>
          <Link to="/broker/login" className="text-sm text-blue-600 font-medium hover:underline">Login to broker portal →</Link>
        </div>
      </div>
    </div>
  )
}
