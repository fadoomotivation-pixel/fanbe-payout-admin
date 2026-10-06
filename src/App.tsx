import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { accountKind, type AccountKind } from '@/lib/brokerAuth'
import { AppLayout } from '@/components/layout/AppLayout.tsx'
import Login from '@/pages/Login'
import BrokerLogin from '@/pages/BrokerLogin'
import BrokerDashboard from '@/pages/BrokerDashboard'
import Dashboard from '@/pages/Dashboard'
import Brokers from '@/pages/Brokers'
import BrokerProfile from '@/pages/BrokerProfile'
import Payouts from '@/pages/Payouts'
import Projects from '@/pages/Projects'
import Plots from '@/pages/Plots'
import Bookings from '@/pages/Bookings'
import Payments from '@/pages/Payments'
import PdcCheques from '@/pages/PdcCheques'
import Registry from '@/pages/Registry'
import ActivityLog from '@/pages/ActivityLog'
import CollectionApp from '@/mobile/CollectionApp'
import { isNativeApp } from '@/lib/platform'
import KYC from '@/pages/KYC'
import Analytics from '@/pages/Analytics'
import Reports from '@/pages/Reports'
import Inquiries from '@/pages/Inquiries'
import Expenses from '@/pages/Expenses'
import Withdrawals from '@/pages/Withdrawals'
import Tickets from '@/pages/Tickets'
import News from '@/pages/News'
import NotFound from '@/pages/NotFound'
import Maintenance from '@/pages/Maintenance'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import Roles from '@/pages/Roles'
import BankAccounts from '@/pages/BankAccounts'
import CommissionRanks from '@/pages/CommissionRanks'
import AchieversClub from '@/pages/AchieversClub'
import TeamRewards from '@/pages/TeamRewards'
import PayoutTerms from '@/pages/PayoutTerms'
import PayoutCycles from '@/pages/PayoutCycles'
import CustomerPipeline from '@/pages/CustomerPipeline'
import BrokerTree from '@/pages/BrokerTree'
import AgentReport from '@/pages/AgentReport'
import EmiOverdue from '@/pages/EmiOverdue'
import EmiCollection from '@/pages/EmiCollection'
import DayBook from '@/pages/DayBook'
import DataHealth from '@/pages/DataHealth'
import Backup from '@/pages/Backup'

// Preserve search params when redirecting (so old links like
// /customer-history?customer=X still land on the right customer view).
function HistoryRedirect(){
  const loc = useLocation()
  return <Navigate to={{ pathname: '/customer-pipeline', search: loc.search }} replace/>
}

// Gate for the office routes.
//
// This used to ask one question — "is there a session?" — and let anyone through who had
// one.  That was fine while only staff had logins.  Every broker has had one since the
// portal went live, so a session no longer says anything about which side of the business
// you are on: a broker could sign in and then simply type /payouts or /expenses in the
// address bar.  The gate now asks who the account belongs to, and sends a broker to their
// own dashboard instead of the admin panel.
//
// Worth being clear about what this is and is not.  This runs in the browser, so it decides
// what is SHOWN, not what may be READ — the database decides that, through row-level
// security.  It is a signpost, not a lock.
function Guard({children}:{children:any}){
  const [kind, setKind] = useState<AccountKind | undefined>(undefined)

  useEffect(() => {
    let active = true
    const check = () => { accountKind().then(k => { if (active) setKind(k) }) }
    check()
    // Re-check on sign-in/sign-out so switching accounts in one tab lands on the right side.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => check())
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  if (kind === undefined) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"/></div>
  }
  if (kind === 'signed-out') return <Navigate to="/login" replace/>
  if (kind === 'broker')     return <Navigate to="/broker/dashboard" replace/>
  // Signed in but linked to neither staff nor a broker — nothing here belongs to them.
  if (kind === 'neither')    return <Navigate to="/login" replace/>
  return children
}

// Reads app_settings.payout_config.maintenance_mode.  When true, every admin route
// renders the Maintenance page instead of the actual content so no one can touch money
// mid-deploy / mid-migration.  Toggled from /payout-terms.  The current admin can still
// get past it by visiting /payout-terms directly (the toggle is needed to turn it back
// off) — that's by design.
//
// The flag is re-fetched on every route change (loc.pathname dep) so flipping it on in
// another tab takes effect the next time admin navigates here.  The PayoutTerms toggle
// also forces a window.location.reload() to fire it instantly in the current tab.
function MaintenanceGate({ children, allowPath }: { children: any; allowPath?: string }) {
  const loc = useLocation()
  const [state, setState] = useState<{ on: boolean; message?: string } | null>(null)
  useEffect(() => {
    let active = true
    supabase.from('app_settings').select('value').eq('key', 'payout_config').maybeSingle().then(({ data }) => {
      if (!active) return
      const v = (data?.value || {}) as any
      setState({ on: !!v.maintenance_mode, message: v.maintenance_message })
    })
    return () => { active = false }
  }, [loc.pathname])
  if (state === null) return children // don't flash maintenance before the fetch resolves
  if (state.on && loc.pathname !== (allowPath || '/payout-terms')) return <Maintenance message={state.message}/>
  return children
}

export default function App(){
  return(
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<Login/>}/>
      <Route path="/broker/login" element={<BrokerLogin/>}/>
      <Route path="/broker/dashboard" element={<BrokerDashboard/>}/>
      {/* The collection app is deliberately outside AppLayout — it has its own bottom-tab
          chrome and is used on a phone, not inside the admin sidebar. Same login. */}
      <Route path="/collect" element={<Guard><CollectionApp/></Guard>}/>
      <Route element={<Guard><MaintenanceGate><AppLayout/></MaintenanceGate></Guard>}>
        {/* The packaged Android build opens on the collection app, not the admin
            dashboard. The APK is for the callers; the sidebar panel is for the office.
            In a browser this is untouched and "/" is still the Dashboard. */}
        <Route path="/" element={isNativeApp() ? <Navigate to="/collect" replace/> : <Dashboard/>}/>
        <Route path="/analytics" element={<Analytics/>}/>
        <Route path="/inquiries" element={<Inquiries/>}/>
        <Route path="/projects" element={<Projects/>}/>
        <Route path="/plots" element={<Plots/>}/>
        {/* Customer History was folded into Customer Pipeline (which now shows a
            customer-aggregate header when ?customer= is set).  Redirect preserves
            the search params so old bookmarks land on the same customer. */}
        <Route path="/customer-history" element={<HistoryRedirect/>}/>
        <Route path="/bookings" element={<Bookings/>}/>
        <Route path="/customer-pipeline" element={<CustomerPipeline/>}/>
        <Route path="/payments" element={<Payments/>}/>
        <Route path="/pdc-cheques" element={<PdcCheques/>}/>
        <Route path="/registry" element={<Registry/>}/>
        <Route path="/emi-overdue" element={<EmiOverdue/>}/>
        <Route path="/emi-collection" element={<EmiCollection/>}/>
        <Route path="/agent-report" element={<AgentReport/>}/>
        <Route path="/day-book" element={<DayBook/>}/>
        <Route path="/record-health" element={<DataHealth/>}/>
        <Route path="/backup" element={<Backup/>}/>
        <Route path="/activity" element={<ActivityLog/>}/>
        <Route path="/emi" element={<Navigate to="/customer-pipeline" replace/>}/>
        <Route path="/brokers" element={<Brokers/>}/>
        <Route path="/team-tree" element={<BrokerTree/>}/>
        <Route path="/brokers/:id" element={<BrokerProfile/>}/>
        <Route path="/kyc" element={<KYC/>}/>
        <Route path="/payouts" element={<Payouts/>}/>
        <Route path="/payout-cycles" element={<PayoutCycles/>}/>
        <Route path="/withdrawals" element={<Withdrawals/>}/>
        {/* Commission Ledger was folded into Payouts — keep this redirect for old bookmarks. */}
        <Route path="/commission" element={<Navigate to="/payouts" replace/>}/>
        <Route path="/commission-ranks" element={<CommissionRanks/>}/>
        <Route path="/achievers-club" element={<AchieversClub/>}/>
        <Route path="/team-rewards" element={<TeamRewards/>}/>
        <Route path="/payout-terms" element={<PayoutTerms/>}/>
        <Route path="/expenses" element={<Expenses/>}/>
        {/* Balance Sheet was a broken 47-line stub that queried a non-existent table
            and always showed ₹0.  Analytics covers the same financial summary correctly. */}
        <Route path="/balance-sheet" element={<Navigate to="/analytics" replace/>}/>
        <Route path="/tickets" element={<Tickets/>}/>
        <Route path="/news" element={<News/>}/>
        <Route path="/roles" element={<Roles/>}/>
        <Route path="/bank-accounts" element={<BankAccounts/>}/>
        <Route path="/reports" element={<Reports/>}/>
        {/* Settings page was a 20-line stub that just showed the logged-in user's email. */}
        <Route path="/settings" element={<Navigate to="/" replace/>}/>
        {/* In-layout 404 — when an admin types a wrong path the sidebar + topbar stay so
            they can keep working.  The outer catch-all below covers auth-only routes. */}
        <Route path="*" element={<NotFound/>}/>
      </Route>
      {/* Catch-all outside the layout for /login, /broker/login, /broker/dashboard typos
          where we don't want the admin chrome.  Real 404 inside the layout is added below
          via a child route. */}
      <Route path="*" element={<NotFound/>}/>
    </Routes>
    </ErrorBoundary>
  )
}
