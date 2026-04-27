import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Map, FileText, Users, UserCheck,
  Banknote, Settings2, BarChart3, Settings, ArrowDownCircle,
  Receipt, PhoneCall, Megaphone, HeadphonesIcon, Scale
} from 'lucide-react'

const sections = [
  {
    label: null,
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ]
  },
  {
    label: 'Operations',
    items: [
      { to: '/projects', icon: Building2, label: 'Projects' },
      { to: '/inventory', icon: Map, label: 'Inventory' },
      { to: '/bookings', icon: FileText, label: 'Bookings' },
      { to: '/customers', icon: Users, label: 'Customers' },
    ]
  },
  {
    label: 'Brokers',
    items: [
      { to: '/brokers', icon: UserCheck, label: 'Brokers' },
      { to: '/enquiries', icon: PhoneCall, label: 'Enquiries' },
    ]
  },
  {
    label: 'Finance',
    items: [
      { to: '/payouts', icon: Banknote, label: 'Payout Queue' },
      { to: '/commission', icon: Settings2, label: 'Commission Rules' },
      { to: '/withdrawals', icon: ArrowDownCircle, label: 'Withdrawals' },
      { to: '/expenses', icon: Receipt, label: 'Expenses' },
      { to: '/balance-sheet', icon: Scale, label: 'Balance Sheet' },
    ]
  },
  {
    label: 'More',
    items: [
      { to: '/reports', icon: BarChart3, label: 'Reports' },
      { to: '/announcements', icon: Megaphone, label: 'Announcements' },
      { to: '/support', icon: HeadphonesIcon, label: 'Support' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ]
  },
]

export default function Sidebar() {
  return (
    <aside className="w-60 bg-slate-900 flex flex-col shrink-0">
      <div className="p-5 border-b border-slate-700">
        <div className="text-white font-bold text-lg">Fanbe</div>
        <div className="text-teal-400 text-xs font-medium mt-0.5">Payout Admin</div>
      </div>
      <nav className="flex-1 p-3 overflow-y-auto space-y-4">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-3 mb-1">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-teal-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`
                }>
                  <Icon size={17} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
