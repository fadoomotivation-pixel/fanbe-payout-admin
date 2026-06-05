import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
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

// Preserve search params when redirecting (so old links like
// /customer-history?customer=X still land on the right customer view).
function HistoryRedirect(){
  const loc = useLocation()
  return <Navigate to={{ pathname: '/customer-pipeline', search: loc.search }} replace/>
}

function Guard({children}:{children:any}){
  const[session,setSession]=useState<any>(undefined)
  useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));const{data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setSession(s));return()=>subscription.unsubscribe()},[])
  if(session===undefined)return<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"/></div>
  if(!session)return<Navigate to="/login" replace/>
  return children
}

// Reads app_settings.payout_config.maintenance_mode on mount.  When true, every admin
// route renders the Maintenance page instead of the actual content so no one can touch
// money mid-deploy / mid-migration.  Toggled from /payout-terms.  The current admin can
// still get past it by visiting /payout-terms directly (the toggle is needed to turn it
// back off) — that's by design.
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
  }, [])
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
      <Route element={<Guard><MaintenanceGate><AppLayout/></MaintenanceGate></Guard>}>
        <Route path="/" element={<Dashboard/>}/>
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
