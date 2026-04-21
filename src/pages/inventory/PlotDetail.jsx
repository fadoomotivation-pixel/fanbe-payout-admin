import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ArrowLeft } from 'lucide-react'
import { PLOT_STATUS_COLORS } from '../../constants/enums'
import { formatINR, formatDate } from '../../lib/utils'

export default function PlotDetail() {
  const { id } = useParams()

  const { data: plot, isLoading } = useQuery({
    queryKey: ['plot', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_plots').select('*, bp_projects(name)').eq('id', id).single()
      return data
    },
  })

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link to="/inventory" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
        <h1 className="page-title">Plot {plot?.plot_no}</h1>
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PLOT_STATUS_COLORS[plot?.status]}`}>{plot?.status}</span>
      </div>

      <div className="card p-5 grid grid-cols-2 gap-4 text-sm">
        <div><p className="text-slate-500 text-xs">Project</p><p className="font-medium mt-0.5">{plot?.bp_projects?.name}</p></div>
        <div><p className="text-slate-500 text-xs">Area (SqYd)</p><p className="font-medium mt-0.5">{plot?.area_sqyd}</p></div>
        <div><p className="text-slate-500 text-xs">Price</p><p className="font-medium mt-0.5">{formatINR(plot?.price)}</p></div>
        <div><p className="text-slate-500 text-xs">Facing</p><p className="font-medium mt-0.5 capitalize">{plot?.facing || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">Corner Plot</p><p className="font-medium mt-0.5">{plot?.is_corner ? 'Yes' : 'No'}</p></div>
        <div><p className="text-slate-500 text-xs">Dimensions</p><p className="font-medium mt-0.5">{plot?.dimensions || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">Survey No</p><p className="font-medium mt-0.5">{plot?.survey_no || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">Added On</p><p className="font-medium mt-0.5">{formatDate(plot?.created_at)}</p></div>
      </div>
    </div>
  )
}