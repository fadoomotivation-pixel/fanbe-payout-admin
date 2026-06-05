import { Wrench } from 'lucide-react'

// Shown whenever an admin enables maintenance mode from /payout-terms.  Locks the entire
// admin shell (sidebar + topbar + every page) behind a single message so no one can
// accidentally touch money mid-deploy / mid-migration.  Admin toggles it back off and the
// app comes alive again.
export default function Maintenance({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-amber-50 to-orange-50">
      <div className="max-w-lg w-full text-center bg-white rounded-2xl border border-amber-200 shadow-sm p-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 text-amber-700 mb-4">
          <Wrench size={28}/>
        </div>
        <div className="text-[10px] uppercase tracking-widest font-bold text-amber-700">Maintenance mode</div>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">We'll be back shortly</h1>
        <p className="text-sm text-gray-600 mt-3">
          {message || 'The Fanbe broker payout system is briefly offline for maintenance. No payments will be processed during this window. Please try again in a few minutes.'}
        </p>
        <div className="mt-6 text-[11px] text-amber-700">
          If you're admin, sign in and visit /payout-terms to turn maintenance off.
        </div>
      </div>
    </div>
  )
}
