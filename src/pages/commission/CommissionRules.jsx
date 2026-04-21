import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

export default function CommissionRules() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRules()
  }, [])

  async function fetchRules() {
    setLoading(true)
    const { data, error } = await supabase.from('bp_commission_rules').select('*').order('created_at', { ascending: false })
    if (error) toast.error(error.message)
    setRules(data || [])
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Commission Rules</h1>
        <p className="text-sm text-slate-500 mt-1">Define commission slabs, payout milestones and broker reward logic.</p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Rule Name</th>
                <th className="px-4 py-3 text-left font-semibold">Project</th>
                <th className="px-4 py-3 text-left font-semibold">Trigger</th>
                <th className="px-4 py-3 text-left font-semibold">Rate / Amount</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rules.length === 0 && <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">No commission rules configured yet.</td></tr>}
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-700">{rule.name || 'Untitled Rule'}</td>
                  <td className="px-4 py-3 text-slate-700">{rule.project_name || rule.project_id || 'All Projects'}</td>
                  <td className="px-4 py-3 text-slate-700">{rule.trigger_stage || rule.trigger_type || 'Booking'}</td>
                  <td className="px-4 py-3 text-slate-700">{rule.rate || rule.amount || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{rule.status || 'Active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
