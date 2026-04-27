import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react'

function fmt(n) {
  if (!n && n !== 0) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export default function BalanceSheet() {
  const [period, setPeriod] = useState('month')

  const { data: bookings = [] } = useQuery({
    queryKey: ['bs_bookings', period],
    queryFn: async () => {
      let q = supabase
        .from('bookings')
        .select('total_amount, paid_amount, created_at, status')
        .eq('status', 'active')
      const { data } = await q
      return data || []
    },
  })

  const { data: payouts = [] } = useQuery({
    queryKey: ['bs_payouts', period],
    queryFn: async () => {
      const { data } = await supabase
        .from('payout_queue')
        .select('amount, status, created_at')
      return data || []
    },
  })

  const { data: expenses = [] } = useQuery({
    queryKey: ['bs_expenses', period],
    queryFn: async () => {
      const { data } = await supabase
        .from('expenses')
        .select('amount, category, created_at')
      return data || []
    },
  })

  const totalRevenue = bookings.reduce((s, b) => s + (b.paid_amount || 0), 0)
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0)
  const totalPayouts = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0)
  const pendingPayouts = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount || 0), 0)
  const netBalance = totalRevenue - totalExpenses - totalPayouts
  const totalReceivable = bookings.reduce((s, b) => s + ((b.total_amount || 0) - (b.paid_amount || 0)), 0)

  const expenseByCategory = expenses.reduce((acc, e) => {
    acc[e.category || 'Other'] = (acc[e.category || 'Other'] || 0) + (e.amount || 0)
    return acc
  }, {})

  const summaryCards = [
    { label: 'Total Collections', value: fmt(totalRevenue), icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Total Expenses', value: fmt(totalExpenses), icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Payouts Disbursed', value: fmt(totalPayouts), icon: DollarSign, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Net Balance', value: fmt(netBalance), icon: DollarSign, color: netBalance >= 0 ? 'text-teal-600' : 'text-red-600', bg: netBalance >= 0 ? 'bg-teal-50' : 'bg-red-50' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Balance Sheet</h1>
          <p className="text-sm text-gray-500">Financial overview &amp; reconciliation</p>
        </div>
        <div className="flex gap-1.5">
          {['week', 'month', 'quarter', 'all'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                period === p ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{p}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center mb-2`}>
              <card.icon size={16} className={card.color} />
            </div>
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className={`text-base font-bold mt-0.5 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Income Summary</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm py-1.5 border-b border-gray-50">
              <span className="text-gray-600">Total Bookings Revenue</span>
              <span className="font-medium text-gray-900">{fmt(bookings.reduce((s, b) => s + (b.total_amount || 0), 0))}</span>
            </div>
            <div className="flex justify-between text-sm py-1.5 border-b border-gray-50">
              <span className="text-gray-600">Amount Collected</span>
              <span className="font-medium text-green-700">{fmt(totalRevenue)}</span>
            </div>
            <div className="flex justify-between text-sm py-1.5">
              <span className="text-gray-600">Outstanding Receivables</span>
              <span className="font-medium text-orange-700">{fmt(totalReceivable)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Expense Breakdown</h2>
          {Object.keys(expenseByCategory).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No expenses recorded</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(expenseByCategory).map(([cat, amt]) => (
                <div key={cat} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-gray-600 capitalize">{cat}</span>
                  <span className="font-medium text-red-700">{fmt(amt)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm py-1.5 font-semibold">
                <span className="text-gray-900">Total</span>
                <span className="text-red-700">{fmt(totalExpenses)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 md:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Payout Summary</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Pending</p>
              <p className="text-base font-bold text-yellow-700">{fmt(pendingPayouts)}</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Disbursed</p>
              <p className="text-base font-bold text-green-700">{fmt(totalPayouts)}</p>
            </div>
            <div className="text-center p-3 bg-teal-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Net Balance</p>
              <p className={`text-base font-bold ${netBalance >= 0 ? 'text-teal-700' : 'text-red-700'}`}>{fmt(netBalance)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
