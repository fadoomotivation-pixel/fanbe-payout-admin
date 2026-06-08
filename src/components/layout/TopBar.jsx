import { useAuth } from '../../hooks/useAuth'
import { LogOut, Bell } from 'lucide-react'
import { BRAND } from '@/lib/branding'

export default function TopBar() {
  const { user, signOut } = useAuth()
  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
      <div className="text-sm text-slate-500">{BRAND.company} — {BRAND.tagline}</div>
      <div className="flex items-center gap-3">
        <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><Bell size={16} /></button>
        <span className="text-sm text-slate-600">{user?.email}</span>
        <button onClick={signOut} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </header>
  )
}
