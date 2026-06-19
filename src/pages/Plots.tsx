import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR } from '@/lib/utils'
import { LayoutGrid, Plus, Layers, Search, Trash2, Edit3, AlertTriangle, ClipboardPaste } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  token: 'bg-amber-100 text-amber-700',
  booked: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  sold: 'bg-purple-100 text-purple-700',
}

const CATEGORIES = ['residential','commercial','industrial','agricultural','villa','apartment'] as const
const FACINGS    = ['east','west','north','south','north-east','north-west','south-east','south-west'] as const

const EMPTY_PLOT = {
  project_id: '', plot_no: '', size_sqyd: '', price_per_sqyd: '', plc_charges: '0',
  category: 'residential', facing: 'east', block: '', sector: '',
  floor: '', is_corner: false, notes: '', status: 'available',
}

const EMPTY_BULK = {
  project_id: '', start_number: '101', end_number: '110',
  size_sqyd: '', price_per_sqyd: '', plc_charges: '0',
  category: 'residential', block: '', sector: '', is_corner: false,
}

const computeTotal = (size: any, rate: any, plc: any) => {
  const s = parseFloat(size) || 0, r = parseFloat(rate) || 0, p = parseFloat(plc) || 0
  return s * r + p
}

export default function Plots() {
  const qc = useQueryClient()
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter]   = useState('')
  // Sale-mode filter — narrow the list to plots sold MLM vs traditionally.  Applied
  // client-side via bookingByPlot since commission_mode lives on bp_bookings, not bp_plots.
  const [saleModeFilter, setSaleModeFilter] = useState<'' | 'mlm' | 'traditional'>('')
  const [search, setSearch]               = useState('')

  // ── Queries ──────────────────────────────────────────────────────
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_projects').select('id,name,location').order('name')
      if (error) throw error
      return data
    },
  })

  const { data: plots = [], isLoading } = useQuery({
    queryKey: ['plots', projectFilter, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_plots')
        .select('*, bp_projects(name, location)')
        .order('plot_no', { ascending: true })
      if (projectFilter) q = q.eq('project_id', projectFilter)
      if (statusFilter)  q = q.eq('status', statusFilter)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  // Compute "in-use" plot IDs so Delete can be guarded.  Same query also exposes the
  // commission_mode + booking_no for each plot so the Status cell can show admins which
  // plot was sold the traditional way vs through the MLM engine.  When a plot has more
  // than one booking we surface the most recent one (DESC sort + first-write-wins on the
  // Map key) — that's the booking the trigger is currently distributing for.
  const { data: bookingByPlot = new Map<string, any>() } = useQuery<Map<string, any>>({
    queryKey: ['plots_in_use'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_bookings')
        .select('plot_id, booking_no, commission_mode, traditional_commission_pct, traditional_commission_per_sqyd, stage, application_date')
        .not('plot_id', 'is', null)
        .order('application_date', { ascending: false })
      const m = new Map<string, any>()
      for (const b of (data || []) as any[]) {
        if (!m.has(b.plot_id)) m.set(b.plot_id, b)
      }
      return m
    },
  })
  const inUseIds = useMemo(() => new Set(bookingByPlot.keys()), [bookingByPlot])

  // ── Mutations ─────────────────────────────────────────────────────
  const createPlot = useMutation({
    mutationFn: async (data: any) => {
      const { error } = await supabase.from('bp_plots').insert(data)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      toast.success('Plot created')
      setAddModal(false); setAddForm(EMPTY_PLOT)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const updatePlot = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { error } = await supabase
        .from('bp_plots')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      toast.success('Plot updated')
      setEditModal(false)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deletePlot = useMutation({
    mutationFn: async (id: string) => {
      if (inUseIds.has(id)) throw new Error('Plot is linked to a booking — cancel or reassign the booking first.')
      const { error } = await supabase.from('bp_plots').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots_in_use'] })
      toast.success('Plot deleted')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const bulkGenerate = useMutation({
    mutationFn: async (bulk: typeof EMPTY_BULK) => {
      if (!bulk.project_id) throw new Error('Select a project')
      const start = parseInt(bulk.start_number)
      const end   = parseInt(bulk.end_number)
      if (Number.isNaN(start) || Number.isNaN(end)) throw new Error('Enter numeric start and end numbers')
      if (end < start) throw new Error('End number must be greater than or equal to start number')
      const count = end - start + 1
      if (count < 1 || count > 500) throw new Error('Range must produce between 1 and 500 plots')
      const size = parseFloat(bulk.size_sqyd)
      if (!size || size <= 0) throw new Error('Size (sqyd) is required')
      const rate = parseFloat(bulk.price_per_sqyd) || 0
      const plc  = parseFloat(bulk.plc_charges) || 0

      // Look for conflicts in this project's plot_nos
      const wanted = Array.from({ length: count }, (_, i) => String(start + i))
      const { data: existing } = await supabase
        .from('bp_plots').select('plot_no').eq('project_id', bulk.project_id).in('plot_no', wanted)
      if (existing && existing.length > 0) {
        const dupes = existing.map((x: any) => x.plot_no).join(', ')
        throw new Error(`Plot numbers already exist in this project: ${dupes}`)
      }

      const rows = wanted.map(plotNo => ({
        project_id: bulk.project_id,
        plot_no:    plotNo,
        size_sqyd:  size,
        price_per_sqyd: rate || null,
        plc_charges:    plc,
        // total_price omitted -- GENERATED column in DB (saveAdd has the same fix).
        category:   bulk.category || 'residential',
        block:      bulk.block || null,
        sector:     bulk.sector || null,
        is_corner:  !!bulk.is_corner,
        status:     'available',
      }))
      const { error } = await supabase.from('bp_plots').insert(rows)
      if (error) throw error
      return count
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      toast.success(`${count} plot${count !== 1 ? 's' : ''} generated`)
      setBulkModal(false); setBulkForm(EMPTY_BULK)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Paste-from-spreadsheet bulk import.  Accepts rows separated by newlines, with
  // columns separated by tabs, commas or pipes (any of them work, so admin can paste
  // straight from Excel/Sheets without choosing a format).  Header row optional.
  // Required columns: plot_no, size_sqyd.  Optional: rate, plc, category, block,
  // sector, facing, floor, is_corner, notes.
  const pasteBulk = useMutation({
    mutationFn: async ({ projectId, text }: { projectId: string; text: string }) => {
      if (!projectId) throw new Error('Pick a project before pasting plots.')
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      if (lines.length === 0) throw new Error('No rows to import.')
      const split = (line: string) => line.split(/[\t,|]/).map(c => c.trim())
      // Detect a header row by trying to parse the first cell as a number; if it's
      // not numeric AND there's a 'plot' word, treat as header.
      const firstCells = split(lines[0]).map(c => c.toLowerCase())
      const hasHeader = firstCells.some(c => /plot|no|number/.test(c)) &&
                        !/^[0-9]+(\.[0-9]+)?$/.test(firstCells[0] || '')
      const header = hasHeader ? firstCells : ['plot_no','size_sqyd','price_per_sqyd','plc_charges','category','block','sector','facing','floor']
      const dataLines = hasHeader ? lines.slice(1) : lines
      const colIdx = (...keys: string[]) => {
        for (const k of keys) {
          const i = header.findIndex(h => h.replace(/[^a-z0-9]/g, '') === k.replace(/[^a-z0-9]/g, ''))
          if (i >= 0) return i
        }
        return -1
      }
      const iPlot   = colIdx('plot_no', 'plotno', 'plotnumber', 'no')
      const iSize   = colIdx('size_sqyd', 'sizesqyd', 'size', 'sqyd', 'sqyards', 'gaj')
      const iRate   = colIdx('price_per_sqyd', 'rate', 'rateperseyd', 'rate_per_sqyd', 'price')
      const iPlc    = colIdx('plc_charges', 'plc')
      const iCat    = colIdx('category')
      const iBlock  = colIdx('block')
      const iSector = colIdx('sector')
      const iFacing = colIdx('facing')
      const iFloor  = colIdx('floor')
      const iCorner = colIdx('is_corner', 'iscorner', 'corner')
      if (iPlot < 0 || iSize < 0) {
        throw new Error('Need at least plot_no and size_sqyd columns. Paste from a spreadsheet with a header row, or include them in this order: plot_no, size_sqyd, rate, plc.')
      }
      const seen = new Set<string>()
      const rows: any[] = []
      const errors: string[] = []
      for (let li = 0; li < dataLines.length; li++) {
        const cells = split(dataLines[li])
        const plotNo = (cells[iPlot] || '').trim()
        const sizeStr = (cells[iSize] || '').replace(/,/g, '').trim()
        const size = parseFloat(sizeStr)
        if (!plotNo || !Number.isFinite(size) || size <= 0) {
          errors.push(`Row ${li + (hasHeader ? 2 : 1)}: missing plot_no or invalid size`)
          continue
        }
        if (seen.has(plotNo)) {
          errors.push(`Row ${li + (hasHeader ? 2 : 1)}: duplicate plot_no '${plotNo}' in pasted text`)
          continue
        }
        seen.add(plotNo)
        const num = (v?: string) => {
          if (!v) return null
          const n = parseFloat(String(v).replace(/,/g, '').trim())
          return Number.isFinite(n) ? n : null
        }
        const cornerVal = iCorner >= 0 ? String(cells[iCorner] || '').toLowerCase() : ''
        rows.push({
          project_id: projectId,
          plot_no:    plotNo,
          size_sqyd:  size,
          price_per_sqyd: iRate   >= 0 ? num(cells[iRate])   : null,
          plc_charges:    iPlc    >= 0 ? (num(cells[iPlc]) ?? 0) : 0,
          // total_price omitted -- GENERATED column.
          category:   iCat    >= 0 ? (cells[iCat] || 'residential') : 'residential',
          block:      iBlock  >= 0 ? (cells[iBlock] || null) : null,
          sector:     iSector >= 0 ? (cells[iSector] || null) : null,
          facing:     iFacing >= 0 ? (cells[iFacing] || 'east') : 'east',
          floor:      iFloor  >= 0 ? (cells[iFloor] || null) : null,
          is_corner:  ['true','yes','y','1','corner'].includes(cornerVal),
          status:     'available',
        })
      }
      if (rows.length === 0) {
        throw new Error('No valid rows. ' + (errors[0] || ''))
      }
      // Detect existing plot_nos in the project so the error mentions specifics
      // instead of the generic constraint message.
      const { data: existing } = await supabase
        .from('bp_plots').select('plot_no').eq('project_id', projectId)
        .in('plot_no', rows.map(r => r.plot_no))
      if (existing && existing.length > 0) {
        throw new Error(`Plot numbers already exist in this project: ${existing.map((x: any) => x.plot_no).join(', ')}`)
      }
      const { error } = await supabase.from('bp_plots').insert(rows)
      if (error) throw error
      return { inserted: rows.length, errors }
    },
    onSuccess: ({ inserted, errors }) => {
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      const trailer = errors.length > 0 ? ` · ${errors.length} row${errors.length !== 1 ? 's' : ''} skipped` : ''
      toast.success(`${inserted} plot${inserted !== 1 ? 's' : ''} added${trailer}`)
      if (errors.length > 0) console.warn('Paste-bulk skipped rows:', errors)
      setPasteModal(false); setPasteText(''); setPasteProjectId('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Local state ───────────────────────────────────────────────────
  const [addModal, setAddModal]   = useState(false)
  const [addForm, setAddForm]     = useState<any>(EMPTY_PLOT)
  const [editModal, setEditModal] = useState(false)
  const [editing, setEditing]     = useState<any>(null)
  const [editForm, setEditForm]   = useState<any>({})
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkForm, setBulkForm]   = useState<any>(EMPTY_BULK)
  const [pasteModal, setPasteModal] = useState(false)
  const [pasteProjectId, setPasteProjectId] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [deleteFor, setDeleteFor] = useState<any>(null)

  const allPlots = plots as any[]
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allPlots.filter((p: any) => {
      if (q && !(
        String(p.plot_no || '').toLowerCase().includes(q) ||
        String(p.block || '').toLowerCase().includes(q) ||
        String(p.sector || '').toLowerCase().includes(q) ||
        String(p.bp_projects?.name || '').toLowerCase().includes(q)
      )) return false
      if (saleModeFilter) {
        const bk = bookingByPlot.get(p.id)
        if (!bk) return false
        if (bk.commission_mode !== saleModeFilter) return false
      }
      return true
    })
  }, [allPlots, search, saleModeFilter, bookingByPlot])

  const availableCount = allPlots.filter(p => p.status === 'available').length
  const tokenCount     = allPlots.filter(p => p.status === 'token').length
  const bookedCount    = allPlots.filter(p => p.status === 'booked').length
  const cancelledCount = allPlots.filter(p => p.status === 'cancelled').length

  // ── Add/Edit helpers ─────────────────────────────────────────────
  const setA = (k: string, v: any) => setAddForm((p: any) => ({ ...p, [k]: v }))
  const setE = (k: string, v: any) => setEditForm((p: any) => ({ ...p, [k]: v }))
  const setB = (k: string, v: any) => setBulkForm((p: any) => ({ ...p, [k]: v }))

  // Auto-recompute total when size/rate/plc change in Add form
  const addTotalPreview  = computeTotal(addForm.size_sqyd, addForm.price_per_sqyd, addForm.plc_charges)
  const editTotalPreview = computeTotal(editForm.size_sqyd, editForm.price_per_sqyd, editForm.plc_charges)
  const bulkTotalPreview = computeTotal(bulkForm.size_sqyd, bulkForm.price_per_sqyd, bulkForm.plc_charges)
  const bulkRangeCount = useMemo(() => {
    const start = parseInt(bulkForm.start_number)
    const end   = parseInt(bulkForm.end_number)
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0
    return end - start + 1
  }, [bulkForm.start_number, bulkForm.end_number])
  const bulkPreviewList = useMemo(() => {
    const start = parseInt(bulkForm.start_number)
    if (Number.isNaN(start) || bulkRangeCount < 1) return [] as string[]
    return Array.from({ length: Math.min(bulkRangeCount, 6) }, (_, i) => String(start + i))
  }, [bulkForm.start_number, bulkRangeCount])

  const openEdit = (p: any) => {
    setEditing(p)
    setEditForm({
      project_id: p.project_id || '',
      plot_no: p.plot_no || '',
      size_sqyd: p.size_sqyd ?? '',
      price_per_sqyd: p.price_per_sqyd ?? '',
      plc_charges: p.plc_charges ?? '0',
      category: p.category || 'residential',
      facing: p.facing || 'east',
      block: p.block || '',
      sector: p.sector || '',
      floor: p.floor || '',
      is_corner: !!p.is_corner,
      notes: p.notes || '',
      status: p.status || 'available',
    })
    setEditModal(true)
  }

  const saveAdd = async () => {
    if (!addForm.project_id) return toast.error('Project is required')
    if (!addForm.plot_no)    return toast.error('Plot number is required')
    if (!addForm.size_sqyd)  return toast.error('Size (sqyd) is required')
    // total_price is a GENERATED column in Postgres (size_sqyd * price_per_sqyd) --
    // sending an explicit value triggers "cannot insert a non-DEFAULT value into
    // column 'total_price'".  Let the DB compute it; the form preview is for the
    // admin only.
    await createPlot.mutateAsync({
      project_id: addForm.project_id,
      plot_no: addForm.plot_no,
      size_sqyd: parseFloat(addForm.size_sqyd),
      price_per_sqyd: addForm.price_per_sqyd !== '' ? parseFloat(addForm.price_per_sqyd) : null,
      plc_charges: addForm.plc_charges !== '' ? parseFloat(addForm.plc_charges) : 0,
      category: addForm.category, facing: addForm.facing,
      block: addForm.block || null, sector: addForm.sector || null,
      floor: addForm.floor || null, is_corner: !!addForm.is_corner,
      notes: addForm.notes || null, status: addForm.status,
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    await updatePlot.mutateAsync({ id: editing.id, data: {
      project_id: editForm.project_id || null,
      plot_no: editForm.plot_no || null,
      size_sqyd: editForm.size_sqyd !== '' ? parseFloat(editForm.size_sqyd) : null,
      price_per_sqyd: editForm.price_per_sqyd !== '' ? parseFloat(editForm.price_per_sqyd) : null,
      plc_charges: editForm.plc_charges !== '' ? parseFloat(editForm.plc_charges) : 0,
      // total_price intentionally omitted -- generated column, see saveAdd.
      category: editForm.category, facing: editForm.facing,
      block: editForm.block || null, sector: editForm.sector || null,
      floor: editForm.floor || null, is_corner: !!editForm.is_corner,
      notes: editForm.notes || null, status: editForm.status,
    }})
  }

  // ── Columns ───────────────────────────────────────────────────────
  const cols = [
    { header: 'Plot No', render: (r: any) => (
      <div>
        <span className="font-bold text-gray-900">#{r.plot_no || '—'}</span>
        {(r.block || r.sector) && <div className="text-[10px] text-gray-400">{r.block ? `Blk ${r.block}` : ''}{r.block && r.sector ? ' · ' : ''}{r.sector ? `Sec ${r.sector}` : ''}</div>}
      </div>
    )},
    { header: 'Project', render: (r: any) => (
      <div>
        <span className="font-medium text-xs text-gray-700">{r.bp_projects?.name || '—'}</span>
        {r.bp_projects?.location && <div className="text-[10px] text-gray-400">{r.bp_projects.location}</div>}
      </div>
    )},
    { header: 'Size', render: (r: any) => <span className="text-sm">{r.size_sqyd ? `${Number(r.size_sqyd).toLocaleString('en-IN')} sqyd` : '—'}</span> },
    { header: 'Type', render: (r: any) => (
      <div className="text-xs">
        <div className="capitalize">{r.category || 'residential'}</div>
        <div className="text-[10px] text-gray-400 capitalize">{r.facing || 'east'}{r.is_corner ? ' · corner' : ''}</div>
      </div>
    )},
    { header: 'Rate / sqyd', render: (r: any) => r.price_per_sqyd ? formatINR(r.price_per_sqyd) : '—' },
    { header: 'PLC', render: (r: any) => r.plc_charges ? formatINR(r.plc_charges) : '—' },
    { header: 'Total Price', render: (r: any) => r.total_price ? <span className="font-semibold">{formatINR(r.total_price)}</span> : '—' },
    { header: 'Status', render: (r: any) => {
      // Sale mode badge appears alongside plot status whenever a booking exists.  Bold
      // amber "Traditional" pill makes the non-MLM sales jump out at a glance — admin
      // doesn't have to click into each booking to remember which way it was sold.
      const bk = bookingByPlot.get(r.id)
      const traditional = bk?.commission_mode === 'traditional'
      return (
        <div className="flex flex-col gap-0.5">
          <Badge label={r.status || 'available'} className={STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}/>
          {bk && (
            <Badge
              label={traditional ? 'Sold · Traditional' : 'Sold · MLM'}
              className={traditional ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-100'}
            />
          )}
        </div>
      )
    }},
    { header: '', render: (r: any) => {
      const inUse = inUseIds.has(r.id)
      return (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Edit3 size={12}/>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleteFor(r)} disabled={inUse}
            className={inUse ? 'opacity-40 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'}>
            <Trash2 size={12}/>{inUse ? 'In use' : 'Delete'}
          </Button>
        </div>
      )
    }},
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-50 rounded-lg"><LayoutGrid size={20} className="text-green-600" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Plots</h1>
            <p className="text-sm text-gray-500">{allPlots.length} plots{search ? ` · ${filtered.length} matching` : ''}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => { setPasteText(''); setPasteProjectId(projectFilter || ''); setPasteModal(true) }} title="Paste rows from Excel / Sheets"><ClipboardPaste size={14}/>Paste plots</Button>
          <Button variant="secondary" onClick={() => { setBulkForm(EMPTY_BULK); setBulkModal(true) }}><Layers size={14}/>Bulk Generate</Button>
          <Button onClick={() => { setAddForm(EMPTY_PLOT); setAddModal(true) }}><Plus size={14}/>Add Plot</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total',     value: allPlots.length, color: 'bg-gray-50 text-gray-700' },
          { label: 'Available', value: availableCount,  color: 'bg-green-50 text-green-700' },
          { label: 'Token',     value: tokenCount,      color: 'bg-amber-50 text-amber-700' },
          { label: 'Booked',    value: bookedCount,     color: 'bg-blue-50 text-blue-700' },
          { label: 'Cancelled', value: cancelledCount,  color: 'bg-red-50 text-red-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs mt-0.5 font-medium opacity-70">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-3 border-b border-gray-100 flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search plot no, block, sector, project..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">All Projects</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">All Status</option>
            {['available','token','booked','cancelled','sold'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
          <select value={saleModeFilter} onChange={e => setSaleModeFilter(e.target.value as any)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" title="Filter by sale mode">
            <option value="">All sale modes</option>
            <option value="mlm">Sold · MLM</option>
            <option value="traditional">Sold · Traditional</option>
          </select>
          {(search || projectFilter || statusFilter || saleModeFilter) && (
            <button onClick={() => { setSearch(''); setProjectFilter(''); setStatusFilter(''); setSaleModeFilter('') }} className="text-xs text-gray-500 hover:text-gray-800 underline">Clear filters</button>
          )}
        </div>
        <Table columns={cols} data={filtered} loading={isLoading} />
      </div>

      {/* ── Add Plot Modal ───────────────────────────────────────── */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Plot">
        <PlotFormFields f={addForm} set={setA} projects={projects as any[]} totalPreview={addTotalPreview} />
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setAddModal(false)}>Cancel</Button>
          <Button onClick={saveAdd} loading={createPlot.isPending}>Create Plot</Button>
        </div>
      </Modal>

      {/* ── Edit Plot Modal ──────────────────────────────────────── */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title={`Edit Plot #${editing?.plot_no ?? ''}`}>
        <PlotFormFields f={editForm} set={setE} projects={projects as any[]} totalPreview={editTotalPreview} />
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setEditModal(false)}>Cancel</Button>
          <Button onClick={saveEdit} loading={updatePlot.isPending}>Save Changes</Button>
        </div>
      </Modal>

      {/* ── Bulk Generate Modal ──────────────────────────────────── */}
      <Modal open={bulkModal} onClose={() => setBulkModal(false)} title="Bulk Generate Plots">
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 mb-4">
          Generate up to <b>500</b> plots in a single range. Plot numbers run from <b>start</b> to <b>end</b> (inclusive).
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Project" value={bulkForm.project_id} onChange={(e: any) => setB('project_id', e.target.value)} className="col-span-2">
            <option value="">Select project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </Select>

          <div className="col-span-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mt-1">Numbering</div>
          <Input label="Start Number" type="number" value={bulkForm.start_number} onChange={(e: any) => setB('start_number', e.target.value)} placeholder="101"/>
          <Input label="End Number"   type="number" value={bulkForm.end_number}   onChange={(e: any) => setB('end_number', e.target.value)}   placeholder="110"/>

          {bulkPreviewList.length > 0 && (
            <div className="col-span-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs">
              <span className="text-gray-500">Preview: </span>
              <span className="font-mono font-semibold">{bulkPreviewList.join(', ')}{bulkRangeCount > 6 ? `, … (${bulkRangeCount} total)` : ''}</span>
            </div>
          )}

          <div className="col-span-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mt-1">Shared attributes</div>
          <Input label="Size (sqyd) *" type="number" value={bulkForm.size_sqyd} onChange={(e: any) => setB('size_sqyd', e.target.value)} />
          <Input label="Rate per sqyd (₹)" type="number" value={bulkForm.price_per_sqyd} onChange={(e: any) => setB('price_per_sqyd', e.target.value)} />
          <Input label="PLC charges (₹)" type="number" value={bulkForm.plc_charges} onChange={(e: any) => setB('plc_charges', e.target.value)} />
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs flex flex-col justify-center">
            <span className="text-gray-500">Computed total / plot</span>
            <span className="font-semibold text-green-700">{formatINR(bulkTotalPreview)}</span>
          </div>
          <Select label="Category" value={bulkForm.category} onChange={(e: any) => setB('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
          </Select>
          <Input label="Block" value={bulkForm.block} onChange={(e: any) => setB('block', e.target.value)} />
          <Input label="Sector" value={bulkForm.sector} onChange={(e: any) => setB('sector', e.target.value)} />
          <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={bulkForm.is_corner} onChange={e => setB('is_corner', e.target.checked)} />
            All plots are corner plots
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setBulkModal(false)}>Cancel</Button>
          <Button onClick={() => bulkGenerate.mutate(bulkForm)} loading={bulkGenerate.isPending} disabled={bulkRangeCount < 1}>
            <Layers size={14}/>Generate {bulkRangeCount || 0} Plots
          </Button>
        </div>
      </Modal>

      {/* ── Paste plots modal ───────────────────────────────────────
          Admin pastes rows from Excel/Sheets/Google Docs.  We auto-detect
          tab / comma / pipe separators and optional header row, so any of:

            101  120  18000
            plot_no,size_sqyd,rate
            12,180,17500

          all import.  Only plot_no and size_sqyd are required; the rest fall
          back to sensible defaults (residential, east, 0 PLC).             */}
      <Modal open={pasteModal} onClose={() => setPasteModal(false)} title="Paste plots from spreadsheet" size="lg">
        <div className="space-y-3">
          <Select label="Project *" value={pasteProjectId} onChange={(e: any) => setPasteProjectId(e.target.value)}>
            <option value="">— pick a project —</option>
            {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rows (plot_no, size_sqyd, rate, plc, category, block, sector, facing, floor, is_corner)</label>
            <Textarea
              rows={12}
              value={pasteText}
              onChange={(e: any) => setPasteText(e.target.value)}
              placeholder={'plot_no\tsize_sqyd\trate\tplc\tcategory\tblock\n101\t180\t17500\t0\tresidential\tA\n102\t200\t17500\t5000\tresidential\tA'}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Copy a range from Excel / Sheets and paste here. Tabs, commas or pipes all work as separators. First row can be a header (plot_no, size_sqyd, ...) or just data. Required: <b>plot_no</b>, <b>size_sqyd</b>. Total price is auto-computed by the database.
            </p>
          </div>
          {(() => {
            const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
            const looksHeader = lines.length > 0 && /plot|no|number/i.test(lines[0]) && !/^\s*[0-9]/.test(lines[0])
            const dataCount = Math.max(0, lines.length - (looksHeader ? 1 : 0))
            return (
              <div className="text-xs text-gray-600 flex items-center gap-2">
                <ClipboardPaste size={12}/>
                {dataCount > 0
                  ? <>Ready to import <span className="font-semibold text-gray-800">{dataCount} plot{dataCount !== 1 ? 's' : ''}</span>{looksHeader ? ' (header row detected)' : ''}.</>
                  : <span className="text-gray-400">Waiting for rows…</span>}
              </div>
            )
          })()}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setPasteModal(false)}>Cancel</Button>
          <Button
            onClick={() => pasteBulk.mutate({ projectId: pasteProjectId, text: pasteText })}
            loading={pasteBulk.isPending}
            disabled={!pasteProjectId || !pasteText.trim()}
          ><ClipboardPaste size={14}/>Import plots</Button>
        </div>
      </Modal>

      {/* ── Delete confirm ───────────────────────────────────────── */}
      <Modal open={!!deleteFor} onClose={() => setDeleteFor(null)} title={`Delete plot #${deleteFor?.plot_no ?? ''}?`} size="sm">
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-900 p-3 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0"/>
          <div>This permanently removes the plot from inventory. Make sure no booking references this plot. This action cannot be undone.</div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setDeleteFor(null)}>Cancel</Button>
          <Button onClick={async () => { await deletePlot.mutateAsync(deleteFor.id); setDeleteFor(null) }} loading={deletePlot.isPending} className="bg-red-600 hover:bg-red-700">
            <Trash2 size={14}/>Delete plot
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function PlotFormFields({ f, set, projects, totalPreview }: any) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Select label="Project *" value={f.project_id} onChange={(e: any) => set('project_id', e.target.value)} className="col-span-2">
        <option value="">Select Project</option>
        {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
      </Select>
      <Input label="Plot No *" value={f.plot_no} onChange={(e: any) => set('plot_no', e.target.value)} placeholder="e.g. GV-A101" />
      <Input label="Size (sqyd) *" type="number" value={f.size_sqyd} onChange={(e: any) => set('size_sqyd', e.target.value)} />
      <Input label="Rate per sqyd (₹)" type="number" value={f.price_per_sqyd} onChange={(e: any) => set('price_per_sqyd', e.target.value)} />
      <Input label="PLC Charges (₹)" type="number" value={f.plc_charges} onChange={(e: any) => set('plc_charges', e.target.value)} placeholder="0" />
      {/* total_price is computed by Postgres (GENERATED column) so it's read-only
          here -- typing an override hit "cannot insert a non-DEFAULT value" before. */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs flex flex-col justify-center col-span-2 sm:col-span-1">
        <span className="text-gray-500">Total price (auto)</span>
        <span className="font-semibold text-green-700">{formatINR(totalPreview)}</span>
        <span className="text-[10px] text-gray-400">= size × rate (PLC added on the booking)</span>
      </div>
      <Select label="Category" value={f.category} onChange={(e: any) => set('category', e.target.value)}>
        {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
      </Select>
      <Select label="Facing" value={f.facing} onChange={(e: any) => set('facing', e.target.value)}>
        {FACINGS.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
      </Select>
      <Input label="Block" value={f.block} onChange={(e: any) => set('block', e.target.value)} placeholder="A"/>
      <Input label="Sector" value={f.sector} onChange={(e: any) => set('sector', e.target.value)} placeholder="12"/>
      <Input label="Floor" value={f.floor} onChange={(e: any) => set('floor', e.target.value)} placeholder="optional"/>
      <Select label="Status" value={f.status} onChange={(e: any) => set('status', e.target.value)}>
        {['available','token','booked','cancelled','sold'].map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
      </Select>
      <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={!!f.is_corner} onChange={e => set('is_corner', e.target.checked)} />
        Corner plot
      </label>
      <Textarea label="Notes" value={f.notes} onChange={(e: any) => set('notes', e.target.value)} className="col-span-2" rows={2} />
    </div>
  )
}
