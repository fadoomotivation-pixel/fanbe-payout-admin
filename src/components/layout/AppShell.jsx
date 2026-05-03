import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, Building2, Map, BookOpen, CreditCard, Banknote,
  Settings, LogOut, ChevronLeft, ChevronRight, BarChart2, FileText,
  UserCheck, Layers, MessageSquare, Megaphone, ShieldCheck, Receipt,
  Wallet, Calculator, TrendingUp, Landmark,
  Bell, Menu, X, ChevronRight as Chevron
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

// Simplified workflow: Customer → Booking. Inquiries / Customer History removed
// from navigation (routes kept for backward compatibility / direct URL access).
const NAV = [
  { group: 'Main', items: [
    { to: '/',               icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/analytics',      icon: BarChart2,        label: 'Analytics' },
    { to: '/balance-sheet',  icon: TrendingUp,       label: 'Balance Sheet' },
  ]},
  { group: 'Customer', items: [
    { to: '/members',        icon: Users,    label: 'Customers' },
  ]},
  { group: 'Real Estate', items: [
    { to: '/projects',  icon: Building2,  label: 'Projects' },
    { to: '/plots',     icon: Map,        label: 'Plots' },
    { to: '/bookings',  icon: BookOpen,   label: 'Bookings' },
    { to: '/payments',  icon: CreditCard, label: 'Payments' },
    { to: '/emi',       icon: Calculator, label: 'EMI Schedule' },
  ]},
  { group: 'Brokerage', items: [
    { to: '/brokers',          icon: Users,    label: 'Brokers' },
    { to: '/kyc',              icon: UserCheck,label: 'KYC Review' },
    { to: '/payouts',          icon: Banknote, label: 'Payouts' },
    { to: '/withdrawals',      icon: Wallet,   label: 'Withdrawals' },
    { to: '/commission',       icon: Layers,   label: 'Commission Rules' },
    { to: '/commission-ranks', icon: Layers,   label: 'Rank Slabs' },
  ]},
  { group: 'Operations', items: [
    { to: '/expenses', icon: Receipt,    label: 'Expenses' },
    { to: '/tickets',  icon: MessageSquare, label: 'Tickets' },
    { to: '/news',     icon: Megaphone,  label: 'News & Events' },
  ]},
  { group: 'Admin', items: [
    { to: '/roles',         icon: ShieldCheck, label: 'Roles & Perms' },
    { to: '/bank-accounts', icon: Landmark,    label: 'Bank Accounts' },
    { to: '/reports',       icon: FileText,    label: 'Reports' },
    { to: '/settings',      icon: Settings,    label: 'Settings' },
  ]},
]

const MOBILE_TABS = [
  { to: '/',          icon: LayoutDashboard, label: 'Home' },
  { to: '/members',   icon: Users,           label: 'Customers' },
  { to: '/bookings',  icon: BookOpen,        label: 'Bookings' },
  { to: '/payments',  icon: CreditCard,      label: 'Payments' },
  { to: '/brokers',   icon: Users,           label: 'Brokers' },
]

function getPageTitle(pathname) {
  const all = NAV.flatMap(g => g.items)
  const match = all.find(i => i.to === pathname || (i.to !== '/' && pathname.startsWith(i.to)))
  return match?.label || 'Dashboard'
}

export default function AppShell() {
  const [collapsed,   setCollapsed]   = useState(false)
  const [mobileOpen,  setMobileOpen]  = useState(false)
  const [user,        setUser]        = useState(null)
  const [notifCount,  setNotifCount]  = useState(0)
  const navigate  = useNavigate()
  const location  = useLocation()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    supabase.from('bp_notifications').select('id', { count: 'exact', head: true })
      .eq('is_read', false)
      .then(({ count }) => setNotifCount(count || 0))
  }, [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const logout = async () => {
    await supabase.auth.signOut()
    toast.success('Logged out')
    navigate('/login')
  }

  const pageTitle = getPageTitle(location.pathname)
  const initials  = user?.email?.[0]?.toUpperCase() || 'A'

  return (
    <div className="app-shell">
      <div className={`mobile-sidebar-overlay ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} />

      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">FB</div>
          {!collapsed && (
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-title">Fanbe Group</div>
              <div className="sidebar-logo-sub">Real Estate CRM</div>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {NAV.map(group => (
            <div key={group.group}>
              <div className="nav-group-label">{collapsed ? '•' : group.group}</div>
              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={16} strokeWidth={2} />
                  {!collapsed && <span className="nav-item-label">{label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={logout}
            className="nav-item"
            style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer' }}
            title={collapsed ? 'Logout' : undefined}
          >
            <LogOut size={16} />
            {!collapsed && <span className="nav-item-label">Logout</span>}
          </button>
        </div>

        <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar">
          {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button
            className="topbar-icon-btn"
            style={{ display: 'none' }}
            id="mobile-menu-btn"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Open menu"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="topbar-breadcrumb">
            <span>Fanbe</span>
            <Chevron size={12} style={{ opacity: 0.4 }} />
            <span className="crumb-current">{pageTitle}</span>
          </div>

          <div className="topbar-actions">
            <button className="topbar-icon-btn" aria-label="Notifications">
              <Bell size={17} />
              {notifCount > 0 && <span className="notif-dot" />}
            </button>

            <div className="topbar-divider" />

            <div className="topbar-avatar" title={user?.email}>{initials}</div>
            <div className="topbar-user" style={{ display: 'none' }} id="topbar-user-info">
              <span className="topbar-user-name">{user?.email?.split('@')[0] || 'Admin'}</span>
              <span className="topbar-user-email">{user?.email || ''}</span>
            </div>

            <button onClick={logout} className="topbar-icon-btn" aria-label="Logout" title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-bottom-nav">
        <div className="mobile-bottom-nav-inner">
          {MOBILE_TABS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={20} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            className="mobile-nav-item"
            onClick={() => setMobileOpen(true)}
            style={{ border: 'none', background: 'none', cursor: 'pointer' }}
          >
            <Menu size={20} />
            <span>More</span>
          </button>
        </div>
      </nav>

      <style>{`
        @media (max-width: 768px) {
          #mobile-menu-btn { display: flex !important; }
          #topbar-user-info { display: flex !important; }
        }
        @media (min-width: 769px) {
          #topbar-user-info { display: flex !important; }
        }
      `}</style>
    </div>
  )
}
