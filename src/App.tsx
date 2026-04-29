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
        <Route path="/projects" element={<Projects/>}/>
        <Route path="/plots" element={<Plots/>}/>
        <Route path="/bookings" element={<Bookings/>}/>
        <Route path="/payments" element={<Payments/>}/>
        <Route path="/brokers" element={<Brokers/>}/>
        <Route path="/kyc" element={<KYC/>}/>
        <Route path="/payouts" element={<Payouts/>}/>
        <Route path="/commission" element={<Commission/>}/>
        <Route path="/reports" element={<Reports/>}/>
        <Route path="/settings" element={<Settings/>}/>
      </Route>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
  )
}