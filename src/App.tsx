import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/layout/AppLayout.tsx'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Brokers from '@/pages/Brokers'
import Payouts from '@/pages/Payouts'
import Projects from '@/pages/Projects'
import Plots from '@/pages/Plots'
import Bookings from '@/pages/Bookings'
import Payments from '@/pages/Payments'
import KYC from '@/pages/KYC'
import Commission from '@/pages/Commission'
import Analytics from '@/pages/Analytics'
import Reports from '@/pages/Reports'
import Settings from '@/pages/Settings'
import Inquiries from '@/pages/Inquiries'
import Members from '@/pages/Members'
import CustomerHistory from '@/pages/CustomerHistory'
import EMI from '@/pages/EMI'
import Expenses from '@/pages/Expenses'
import BalanceSheet from '@/pages/BalanceSheet'
import Withdrawals from '@/pages/Withdrawals'
import Tickets from '@/pages/Tickets'
import News from '@/pages/News'
import Roles from '@/pages/Roles'
import BankAccounts from '@/pages/BankAccounts'
import CommissionRanks from '@/pages/CommissionRanks'
import AchieversClub from '@/pages/AchieversClub'
import TeamRewards from '@/pages/TeamRewards'

function Guard({children}:{children:any}){
  const[session,setSession]=useState<any>(undefined)
  useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));const{data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setSession(s));return()=>subscription.unsubscribe()},[])
  if(session===undefined)return<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"/></div>
  if(!session)return<Navigate to="/login" replace/>
  return children
}

export default function App(){
  return(
    <Routes>
      <Route path="/login" element={<Login/>}/>
      <Route element={<Guard><AppLayout/></Guard>}>
        <Route path="/" element={<Dashboard/>}/>
        <Route path="/analytics" element={<Analytics/>}/>
        <Route path="/inquiries" element={<Inquiries/>}/>
        <Route path="/projects" element={<Projects/>}/>
        <Route path="/plots" element={<Plots/>}/>
        <Route path="/members" element={<Members/>}/>
        <Route path="/customer-history" element={<CustomerHistory/>}/>
        <Route path="/bookings" element={<Bookings/>}/>
        <Route path="/payments" element={<Payments/>}/>
        <Route path="/emi" element={<EMI/>}/>
        <Route path="/brokers" element={<Brokers/>}/>
        <Route path="/kyc" element={<KYC/>}/>
        <Route path="/payouts" element={<Payouts/>}/>
        <Route path="/withdrawals" element={<Withdrawals/>}/>
        <Route path="/commission" element={<Commission/>}/>
        <Route path="/commission-ranks" element={<CommissionRanks/>}/>
        <Route path="/achievers-club" element={<AchieversClub/>}/>
        <Route path="/team-rewards" element={<TeamRewards/>}/>
        <Route path="/expenses" element={<Expenses/>}/>
        <Route path="/balance-sheet" element={<BalanceSheet/>}/>
        <Route path="/tickets" element={<Tickets/>}/>
        <Route path="/news" element={<News/>}/>
        <Route path="/roles" element={<Roles/>}/>
        <Route path="/bank-accounts" element={<BankAccounts/>}/>
        <Route path="/reports" element={<Reports/>}/>
        <Route path="/settings" element={<Settings/>}/>
      </Route>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
  )
}
