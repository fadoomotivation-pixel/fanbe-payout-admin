// Backup & export — every record this panel keeps, downloaded to the office computer.
//
// One button saves the whole book as a single .json file (everything needed to put the
// data back); each table can also be saved as a CSV to open in Excel.  Nothing here writes
// to the database — it only reads, with the logged-in admin's own access.
//
// The call-centre data that shares this database (leads, calls, attendance) belongs to the
// other app and is not part of this backup.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fetchAllRows, todayLocalISO } from '@/lib/fetchAll'
import { downloadCsv, downloadJson } from '@/lib/download'
import { DatabaseBackup, Download, FileJson, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

// Table, what it holds, and the column to page through it by (every table needs a stable
// order or paging can skip or repeat rows).
const TABLES: { name: string; label: string; order: string }[] = [
  { name: 'bp_projects',            label: 'Projects',                     order: 'id' },
  { name: 'bp_plots',               label: 'Plots',                        order: 'id' },
  { name: 'bp_customers',           label: 'Customers',                    order: 'id' },
  { name: 'brokers',                label: 'Brokers',                      order: 'id' },
  { name: 'bp_bookings',            label: 'Bookings',                     order: 'id' },
  { name: 'bp_booking_plots',       label: 'Booking ↔ plots',              order: 'id' },
  { name: 'bp_booking_brokers',     label: 'Booking split brokers',        order: 'id' },
  { name: 'bp_payments',            label: 'Payments / receipts',          order: 'id' },
  { name: 'emi_schedules',          label: 'EMI plans',                    order: 'id' },
  { name: 'emi_installments',       label: 'EMI instalments (kist)',       order: 'id' },
  { name: 'bp_pdc_cheques',         label: 'PDC cheques',                  order: 'id' },
  { name: 'payout_distributions',   label: 'Commission credited',          order: 'id' },
  { name: 'payout_cycles',          label: 'Payout cycles',                order: 'id' },
  { name: 'bp_payout_transactions', label: 'Payout transactions',          order: 'id' },
  { name: 'withdrawal_requests',    label: 'Withdrawals',                  order: 'id' },
  { name: 'expenses',               label: 'Expenses',                     order: 'id' },
  { name: 'expense_heads',          label: 'Expense heads',                order: 'id' },
  { name: 'bp_broker_kyc',          label: 'Broker KYC documents',         order: 'id' },
  { name: 'commission_ranks',       label: 'Rank slabs',                   order: 'id' },
  { name: 'team_reward_tiers',      label: 'Team reward tiers',            order: 'id' },
  { name: 'company_bank_accounts',  label: 'Company bank accounts',        order: 'id' },
  { name: 'app_settings',           label: 'Payout settings',              order: 'key' },
  { name: 'app_users',              label: 'Staff accounts',               order: 'id' },
  { name: 'closure_audit',          label: 'Close / reopen log',           order: 'id' },
  { name: 'bp_activity_log',        label: 'Activity log',                 order: 'id' },
]

const fetchTable = (t: { name: string; order: string }) =>
  fetchAllRows((from, to) => supabase.from(t.name).select('*').order(t.order).range(from, to))

// Nested values (json columns) go into one cell as JSON text.
function tableToRows(rows: any[]): unknown[][] {
  const cols: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  return [cols, ...rows.map(r => cols.map(c => {
    const v = r[c]
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  }))]
}

export default function Backup() {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ at: string; rows: number; failed: string[] } | null>(null)

  const { data: counts = {}, isLoading } = useQuery<Record<string, number | null>>({
    queryKey: ['backup_counts'],
    queryFn: async () => {
      const out: Record<string, number | null> = {}
      await Promise.all(TABLES.map(async t => {
        const { count, error } = await supabase.from(t.name).select('*', { count: 'exact', head: true })
        out[t.name] = error ? null : (count ?? 0)
      }))
      return out
    },
  })

  const fullBackup = async () => {
    setBusy('all')
    const tables: Record<string, any[]> = {}
    const failed: string[] = []
    let total = 0
    try {
      for (const t of TABLES) {
        try {
          const rows = await fetchTable(t)
          tables[t.name] = rows
          total += rows.length
        } catch (e: any) {
          failed.push(`${t.name}: ${e?.message || 'could not be read'}`)
        }
      }
      const at = new Date().toISOString()
      downloadJson(`fanbe-backup-${todayLocalISO()}.json`, {
        app: 'fanbe-payout-admin', created_at: at,
        counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
        failed, tables,
      })
      setDone({ at, rows: total, failed })
      if (failed.length) toast.error(`Backup saved, but ${failed.length} table(s) could not be read — see the list.`)
      else toast.success(`Backup saved · ${total.toLocaleString('en-IN')} records`)
    } finally {
      setBusy(null)
    }
  }

  const tableCsv = async (t: typeof TABLES[number]) => {
    setBusy(t.name)
    try {
      const rows = await fetchTable(t)
      if (rows.length === 0) { toast('This table is empty.'); return }
      downloadCsv(`${t.name}-${todayLocalISO()}.csv`, tableToRows(rows))
    } catch (e: any) {
      toast.error(e?.message || 'Could not read this table.')
    } finally {
      setBusy(null)
    }
  }

  const totalRows = Object.values(counts).reduce<number>((s, n) => s + (n || 0), 0)

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><DatabaseBackup size={18} className="text-blue-600"/>Backup &amp; export</h1>
        <p className="text-sm text-gray-500 mt-0.5">Save a copy of every record to this computer. Take one before any big change, and keep it somewhere safe — it holds customer phone numbers and PAN.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold text-gray-900">Full backup</div>
          <div className="text-[12px] text-gray-500">
            All {TABLES.length} tables{isLoading ? '' : ` · ${totalRows.toLocaleString('en-IN')} records`} in one .json file. This is the file to keep — the data can be put back from it.
          </div>
        </div>
        <button onClick={fullBackup} disabled={!!busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-50">
          <FileJson size={15}/>{busy === 'all' ? 'Saving…' : 'Download full backup'}
        </button>
      </div>

      {done && (
        <div className={`rounded-xl border p-3 text-sm ${done.failed.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
          <div className="flex items-center gap-2 font-medium">
            {done.failed.length ? <AlertTriangle size={14}/> : <CheckCircle2 size={14}/>}
            Backup saved at {new Date(done.at).toLocaleString('en-IN')} · {done.rows.toLocaleString('en-IN')} records
          </div>
          {done.failed.length > 0 && (
            <ul className="mt-1 text-[12px] list-disc pl-5">{done.failed.map(f => <li key={f}>{f}</li>)}</ul>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">One table at a time (opens in Excel)</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {TABLES.map(t => (
            <div key={t.name} className="px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900">{t.label}</div>
                <div className="text-[11px] text-gray-400 font-mono">{t.name}</div>
              </div>
              <div className="text-[12px] text-gray-500 tabular-nums w-20 text-right">
                {isLoading ? '…' : counts[t.name] == null ? <span className="text-rose-600">no access</span> : counts[t.name]!.toLocaleString('en-IN')}
              </div>
              <button onClick={() => tableCsv(t)} disabled={!!busy || !counts[t.name]}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40">
                <Download size={12}/>{busy === t.name ? 'Saving…' : 'CSV'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
