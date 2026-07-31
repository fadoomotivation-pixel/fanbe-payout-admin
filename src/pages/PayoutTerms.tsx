import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ScrollText, Save, CheckCircle2, AlertTriangle, Wrench, Power } from 'lucide-react';

interface PayoutTerms {
  id: number;
  differential_basis: boolean;
  closing_frequency: 'daily' | 'weekly' | 'monthly';
  distribution_frequency: 'daily' | 'weekly' | 'monthly';
  block_equal_or_super_seeded: boolean;
  require_booking_amount: boolean;
  payout_on_deposited_only: boolean;
  installment_grace_days: number;
  notes: string | null;
}

const DEFAULT: PayoutTerms = {
  id: 1,
  differential_basis: true,
  closing_frequency: 'daily',
  distribution_frequency: 'monthly',
  block_equal_or_super_seeded: true,
  require_booking_amount: true,
  payout_on_deposited_only: true,
  installment_grace_days: 90,
  notes: '',
};

export default function PayoutTerms() {
  const [terms, setTerms] = useState<PayoutTerms>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Maintenance toggle lives in app_settings.payout_config so the MaintenanceGate in
  // App.tsx (which reads on mount) can pick it up.  Separate state from terms so the Save
  // Terms button doesn't accidentally write it.
  const [maintenanceOn, setMaintenanceOn] = useState(false);
  const [maintenanceMsg, setMaintenanceMsg] = useState('');
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data, error }, { data: cfg }] = await Promise.all([
        supabase.from('payout_terms_config').select('*').eq('id', 1).maybeSingle(),
        supabase.from('app_settings').select('value').eq('key', 'payout_config').maybeSingle(),
      ]);
      if (error) setError(error.message);
      else if (data) setTerms(data as PayoutTerms);
      const v = (cfg?.value || {}) as any;
      setMaintenanceOn(!!v.maintenance_mode);
      setMaintenanceMsg(v.maintenance_message || '');
      setLoading(false);
    })();
  }, []);

  async function toggleMaintenance(next: boolean) {
    setMaintenanceSaving(true);
    const { data: cfg } = await supabase.from('app_settings').select('value').eq('key', 'payout_config').maybeSingle();
    const prev = (cfg?.value || {}) as any;
    const value = { ...prev, maintenance_mode: next, maintenance_message: maintenanceMsg || null };
    const { error: upErr } = await supabase.from('app_settings').upsert({ key: 'payout_config', value }, { onConflict: 'key' });
    setMaintenanceSaving(false);
    if (upErr) { setError(upErr.message); return; }
    setMaintenanceOn(next);
    // MaintenanceGate in App.tsx reads the flag once on mount, so without a reload the
    // admin shell would keep running until the next full page load.  Force a reload so
    // the kill-switch takes effect immediately — that's the whole point of a kill-switch.
    setTimeout(() => window.location.reload(), 250);
  }

  async function save() {
    setSaving(true); setError(null);
    const { error } = await supabase
      .from('payout_terms_config')
      .upsert({ ...terms, id: 1, updated_at: new Date().toISOString() });
    if (error) setError(error.message);
    else setSavedAt(new Date());
    setSaving(false);
  }

  const Toggle = ({label, value, onChange, hint}:{label:string,value:boolean,onChange:(v:boolean)=>void,hint?:string}) => (
    <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
      <input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded text-teal-600 focus:ring-teal-500" />
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
    </label>
  );

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <ScrollText className="text-indigo-500" size={28} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payout Terms</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Configure how broker commissions are calculated and when payouts are released
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Maintenance kill-switch.  When on, the admin shell shows a Maintenance page on
          every route except this one (so admin can come back here and turn it off). */}
      {!loading && (
        <div className={`mb-4 rounded-xl border p-4 ${maintenanceOn ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}>
          <div className="flex items-start gap-3">
            <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${maintenanceOn ? 'bg-amber-200 text-amber-900' : 'bg-gray-100 text-gray-500'}`}>
              <Wrench size={18}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-900">Maintenance mode</h3>
                <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full ${maintenanceOn ? 'bg-amber-200 text-amber-900' : 'bg-gray-100 text-gray-600'}`}>
                  {maintenanceOn ? 'ON · admin shell offline' : 'OFF · normal operation'}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                When on, every admin route shows a "We'll be back shortly" page. Use this during deploys, migrations, or any time you need to make sure no one touches money. This page stays accessible so you can turn it back off.
              </p>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  value={maintenanceMsg}
                  onChange={e => setMaintenanceMsg(e.target.value)}
                  placeholder="Optional custom message shown to admins"
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <button
                  onClick={() => toggleMaintenance(!maintenanceOn)}
                  disabled={maintenanceSaving}
                  className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 ${maintenanceOn ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
                >
                  <Power size={14}/>{maintenanceSaving ? 'Saving…' : (maintenanceOn ? 'Turn maintenance OFF' : 'Turn maintenance ON')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading…</div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-3">
            <Toggle
              label="Payout on differentials basis"
              hint="Upline earns the difference between their rank % and downline rank %"
              value={terms.differential_basis}
              onChange={v => setTerms(t => ({ ...t, differential_basis: v }))} />

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border border-gray-200 rounded-lg">
                <label className="text-sm font-medium text-gray-800 block mb-1">Closing frequency</label>
                <select className="border rounded px-2 py-1 w-full text-sm"
                  value={terms.closing_frequency}
                  onChange={e => setTerms(t => ({ ...t, closing_frequency: e.target.value as any }))}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Brochure: daily</p>
              </div>
              <div className="p-3 border border-gray-200 rounded-lg">
                <label className="text-sm font-medium text-gray-800 block mb-1">Distribution frequency</label>
                <select className="border rounded px-2 py-1 w-full text-sm"
                  value={terms.distribution_frequency}
                  onChange={e => setTerms(t => ({ ...t, distribution_frequency: e.target.value as any }))}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Brochure: monthly</p>
              </div>
            </div>

            <Toggle
              label="Block payout on equal-rank or super-seeded teams"
              hint="No payout calculated when downline matches or exceeds upline rank"
              value={terms.block_equal_or_super_seeded}
              onChange={v => setTerms(t => ({ ...t, block_equal_or_super_seeded: v }))} />

            <Toggle
              label="Sale counted only when booking amount is fully deposited"
              value={terms.require_booking_amount}
              onChange={v => setTerms(t => ({ ...t, require_booking_amount: v }))} />

            <Toggle
              label="Payout calculated on deposited amount only"
              value={terms.payout_on_deposited_only}
              onChange={v => setTerms(t => ({ ...t, payout_on_deposited_only: v }))} />

            <div className="p-3 border border-gray-200 rounded-lg">
              <label className="text-sm font-medium text-gray-800 block mb-1">
                Instalment grace period (days)
              </label>
              <input type="number" className="border rounded px-2 py-1 w-32 text-sm"
                value={terms.installment_grace_days}
                onChange={e => setTerms(t => ({ ...t, installment_grace_days: Number(e.target.value) }))} />
              <p className="text-xs text-gray-500 mt-1">
                Irregular deposits beyond grace period cause payout lapsation. Brochure: 90 days.
              </p>
            </div>

            <div className="p-3 border border-gray-200 rounded-lg">
              <label className="text-sm font-medium text-gray-800 block mb-1">Notes</label>
              <textarea className="border rounded px-2 py-1 w-full text-sm" rows={4}
                value={terms.notes ?? ''}
                onChange={e => setTerms(t => ({ ...t, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-4">
            {savedAt && (
              <span className="text-xs text-green-600 inline-flex items-center gap-1">
                <CheckCircle2 size={13} /> Saved at {savedAt.toLocaleTimeString()}
              </span>
            )}
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              <Save size={14} /> {saving ? 'Saving…' : 'Save Terms'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
