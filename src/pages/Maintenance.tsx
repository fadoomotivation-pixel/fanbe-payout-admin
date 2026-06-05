import { AlertOctagon } from 'lucide-react'

// When maintenance mode is ON (toggled from /payout-terms), every admin route renders
// this in place of the actual page.  Stark error styling — not "friendly maintenance" —
// so admin can tell at a glance the system is intentionally offline, not just slow.
export default function Maintenance({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="max-w-md w-full text-center bg-white border-2 border-rose-200 rounded-2xl shadow-sm p-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-rose-100 text-rose-700 mb-4">
          <AlertOctagon size={32}/>
        </div>
        <div className="text-[10px] uppercase tracking-widest font-bold text-rose-600">Error 503</div>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Service Unavailable</h1>
        <p className="text-sm text-gray-600 mt-3">
          {message || 'This page cannot be loaded right now.'}
        </p>
      </div>
    </div>
  )
}
