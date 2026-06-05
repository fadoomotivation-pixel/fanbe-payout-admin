import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Home, Search } from 'lucide-react'

// Real 404 page.  Replaces the catch-all `<Navigate to="/" replace/>` in App.tsx that used
// to silently send users home — which made a typo'd URL feel like the app had eaten the
// click.  Now they see what went wrong and have a way back.
export default function NotFound() {
  const loc = useLocation()
  const nav = useNavigate()

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-50 border border-amber-200 text-amber-600 mb-5">
          <AlertCircle size={32}/>
        </div>
        <div className="text-6xl font-bold text-gray-900 tracking-tight">404</div>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">Page not found</h1>
        <p className="text-sm text-gray-500 mt-2">
          Nothing lives at <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-gray-700">{loc.pathname}</code>
          {loc.search && <> with <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-gray-700">{loc.search}</code></>}.
          Maybe the link is wrong, the page was moved, or it never existed.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => nav(-1)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
          >
            <ArrowLeft size={14}/>Go back
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Home size={14}/>Dashboard
          </Link>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100">
          <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-2">Common places</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <QuickLink to="/customer-pipeline" label="Customer Pipeline"/>
            <QuickLink to="/brokers"           label="Brokers"/>
            <QuickLink to="/payouts"           label="Pay brokers"/>
            <QuickLink to="/withdrawals"       label="Withdrawals"/>
            <QuickLink to="/kyc"               label="KYC Review"/>
            <QuickLink to="/analytics"         label="Analytics"/>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center justify-between gap-1 px-3 py-1.5 rounded-md border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700">
      <span>{label}</span>
      <Search size={11} className="opacity-40"/>
    </Link>
  )
}
