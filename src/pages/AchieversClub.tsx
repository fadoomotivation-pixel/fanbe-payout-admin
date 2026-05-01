// ─────────────────────────────────────────────────────────────────────────────
// AchieversClub.tsx  —  Fanbe Group Admin
// Monthly pool: ₹100 × fresh sq yards sold that month
// Qualifying brokers get pool ÷ qualifiers, paid in 3 monthly instalments
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface AchieversMonth {
  id: string
  month_year: string          // 'YYYY-MM'
  total_fresh_sq_yards: number
  total_pool: number          // ₹100 × sq_yards
  qualifying_count: number
  per_achiever_amount: number
  monthly_instalment: number  // per_achiever / 3
  status: 'pending' | 'distributed' | 'partial'
  created_at: string
}

interface AchieverPayout {
  id: string
  month_id: string
  broker_id: string
  instalment_no: 1 | 2 | 3
  amount: number
  status: 'pending' | 'paid'
  paid_at: string | null
  broker_name?: string
}

const STATUS_BADGE: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-800',
  distributed: 'bg-green-100 text-green-800',
  partial:     'bg-blue-100 text-blue-800',
  paid:        'bg-green-100 text-green-800',
}

export default function AchieversClub() {
  const [months, setMonths] = useState<AchieversMonth[]>([])
  const [selectedMonth, setSelectedMonth] = useState<AchieversMonth | null>(null)
  const [payouts, setPayouts] = useState<AchieverPayout[]>([])
  const [loadingMonths, setLoadingMonths] = useState(true)
  const [loadingPayouts, setLoadingPayouts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── New month form state ──────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [formMonth, setFormMonth] = useState('')       // YYYY-MM
  const [formSqYards, setFormSqYards] = useState('')
  const [formSaving, setFormSaving] = useState(false)

  useEffect(() => { loadMonths() }, [])

  async function loadMonths() {
    setLoadingMonths(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('achievers_club_months')
      .select('*')
      .order('month_year', { ascending: false })
    if (err) { setError(err.message); setLoadingMonths(false); return }
    setMonths(data ?? [])
    setLoadingMonths(false)
  }

  async function loadPayouts(monthId: string) {
    setLoadingPayouts(true)
    const { data, error: err } = await supabase
      .from('achievers_club_payouts')
      .select(`
        *,
        brokers:broker_id ( full_name )
      `)
      .eq('month_id', monthId)
      .order('instalment_no')
    if (err) { setError(err.message); setLoadingPayouts(false); return }
    const enriched = (data ?? []).map((p: AchieverPayout & { brokers?: { full_name: string } }) => ({
      ...p,
      broker_name: p.brokers?.full_name ?? p.broker_id.slice(0, 8) + '…',
    }))
    setPayouts(enriched)
    setLoadingPayouts(false)
  }

  function selectMonth(m: AchieversMonth) {
    setSelectedMonth(m)
    loadPayouts(m.id)
  }

  async function saveMonth() {
    if (!formMonth || !formSqYards) return
    setFormSaving(true)
    setError(null)
    const sqYards = parseFloat(formSqYards)
    const totalPool = sqYards * 100
    // qualifying_count & per_achiever must be computed separately;
    // seed with 0 — admin fills after distribution
    const { error: err } = await supabase
      .from('achievers_club_months')
      .upsert({
        month_year: formMonth,
        total_fresh_sq_yards: sqYards,
        total_pool: totalPool,
        qualifying_count: 0,
        per_achiever_amount: 0,
        monthly_instalment: 0,
        status: 'pending',
      }, { onConflict: 'month_year' })
    if (err) { setError(err.message) }
    else {
      setShowForm(false)
      setFormMonth('')
      setFormSqYards('')
      loadMonths()
    }
    setFormSaving(false)
  }

  async function markInstalmentPaid(payoutId: string) {
    await supabase
      .from('achievers_club_payouts')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', payoutId)
    if (selectedMonth) loadPayouts(selectedMonth.id)
  }

  const fmtINR = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

  const fmtMonth = (ym: string) => {
    const [y, m] = ym.split('-')
    return new Date(+y, +m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Achievers Club</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monthly income pool · ₹100 per fresh sq. yard sold · Paid in 3 instalments
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Month
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* New Month Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Record Monthly Sq. Yards</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
              <input
                type="month"
                value={formMonth}
                onChange={e => setFormMonth(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fresh Sq. Yards Sold</label>
              <input
                type="number"
                placeholder="e.g. 450"
                value={formSqYards}
                onChange={e => setFormSqYards(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
          {formSqYards && (
            <div className="bg-indigo-50 rounded-lg px-4 py-2 text-sm text-indigo-800">
              Pool = ₹100 × {parseFloat(formSqYards).toLocaleString('en-IN')} sq.yd
              = <strong>{fmtINR(parseFloat(formSqYards) * 100)}</strong>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={saveMonth}
              disabled={formSaving || !formMonth || !formSqYards}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {formSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Month List */}
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Months</h2>
          {loadingMonths ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : months.length === 0 ? (
            <div className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 p-6 text-center">
              <p className="text-gray-400 text-sm">No months recorded yet</p>
              <button onClick={() => setShowForm(true)} className="mt-2 text-indigo-600 text-sm underline">
                Add first month
              </button>
            </div>
          ) : (
            months.map(m => (
              <button
                key={m.id}
                onClick={() => selectMonth(m)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  selectedMonth?.id === m.id
                    ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-800 text-sm">{fmtMonth(m.month_year)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[m.status]}`}>
                    {m.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {m.total_fresh_sq_yards.toLocaleString('en-IN')} sq.yd &nbsp;·&nbsp;
                  Pool: <span className="font-medium text-gray-700">{fmtINR(m.total_pool)}</span>
                </div>
                {m.qualifying_count > 0 && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {m.qualifying_count} achiever{m.qualifying_count !== 1 ? 's' : ''} &nbsp;·&nbsp;
                    {fmtINR(m.monthly_instalment)}/instalment
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Month Detail */}
        <div className="lg:col-span-2">
          {!selectedMonth ? (
            <div className="h-full flex items-center justify-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 min-h-64">
              <p className="text-gray-400 text-sm">← Select a month to view payouts</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Month Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Sq. Yards', value: selectedMonth.total_fresh_sq_yards.toLocaleString('en-IN') },
                  { label: 'Total Pool', value: fmtINR(selectedMonth.total_pool) },
                  { label: 'Achievers', value: selectedMonth.qualifying_count.toString() },
                  { label: 'Per Instalment', value: fmtINR(selectedMonth.monthly_instalment) },
                ].map(card => (
                  <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                    <p className="font-bold text-gray-900 text-lg">{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Instalment Payout Table */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-800 text-sm">
                    Instalment Payouts — {fmtMonth(selectedMonth.month_year)}
                  </h3>
                </div>
                {loadingPayouts ? (
                  <div className="p-8 flex justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
                  </div>
                ) : payouts.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">
                    No payout rows yet for this month
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Broker</th>
                          <th className="px-4 py-2 text-center font-semibold text-gray-600">Instalment</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600">Amount</th>
                          <th className="px-4 py-2 text-center font-semibold text-gray-600">Status</th>
                          <th className="px-4 py-2 text-center font-semibold text-gray-600">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {payouts.map(p => (
                          <tr key={p.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-800">{p.broker_name}</td>
                            <td className="px-4 py-2 text-center">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                                {p.instalment_no}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right font-medium text-gray-900">{fmtINR(p.amount)}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[p.status]}`}>
                                {p.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              {p.status === 'pending' && (
                                <button
                                  onClick={() => markInstalmentPaid(p.id)}
                                  className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                                >
                                  Mark Paid
                                </button>
                              )}
                              {p.status === 'paid' && p.paid_at && (
                                <span className="text-xs text-gray-400">
                                  {new Date(p.paid_at).toLocaleDateString('en-IN')}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rule card */}
      <div className="rounded-lg bg-teal-50 border border-teal-200 p-4 text-sm text-teal-800">
        <p className="font-semibold mb-1">🏆 Achievers Club Rule</p>
        <p>
          Pool = ₹100 × total fresh sq. yards sold that month.
          Qualifying brokers (those who sold in that month) share the pool equally.
          Each broker receives their share in <strong>3 equal monthly instalments</strong>.
        </p>
      </div>
    </div>
  )
}
