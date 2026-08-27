import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { bookingValue, balanceOf, paidByBooking, isRegistryDone } from '@/lib/bookingMath'

// Data for the business screens (bookings, customers, projects, plots).
//
// Two rules run through all of it, because a phone is not a desktop:
//   nothing unbounded — bp_plots alone is 4,674 rows, and a list that fetches everything
//     to show twenty is slow on a cheap handset and expensive on mobile data
//   money always via lib/bookingMath — the same value/paid/balance the admin panel shows,
//     so a caller quoting a balance over the phone is quoting the same number the office
//     is looking at

const PAGE = 30

export type BookingRow = {
  id: string
  bookingNo: string
  legacyNo: string | null
  stage: string
  customerId: string | null
  name: string
  phone: string | null
  projectName: string | null
  plotNo: string | null
  value: number
  paid: number
  balance: number
  registryDone: boolean
  date: string | null
}

function toRow(b: any, paid: Record<string, number>): BookingRow {
  const value = bookingValue(b)
  const got = paid[b.id] || 0
  return {
    id: b.id,
    bookingNo: b.booking_no || '',
    legacyNo: b.legacy_booking_no || null,
    stage: b.stage || '',
    customerId: b.bp_customers?.id ?? b.customer_id ?? null,
    name: b.bp_customers?.name || '(no name)',
    phone: b.bp_customers?.phone || null,
    projectName: b.bp_projects?.name || null,
    plotNo: b.bp_plots?.plot_no || null,
    value,
    paid: got,
    balance: balanceOf(value, got),
    registryDone: isRegistryDone(b),
    date: b.application_date || null,
  }
}

const BOOKING_SELECT = `
  id, booking_no, legacy_booking_no, stage, application_date, total_amount, plot_total_price,
  customer_id, registry_date, registry_completed_at,
  bp_customers(id, name, phone, customer_code),
  bp_projects(name),
  bp_plots(plot_no)
`

/** Bookings list: server-side stage filter and search, one page at a time. */
export function useBookings(opts: { search: string; stage: string; page: number }) {
  const { search, stage, page } = opts
  return useQuery({
    queryKey: ['m_bookings', search, stage, page],
    queryFn: async () => {
      let q = supabase.from('bp_bookings')
        .select(BOOKING_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false })

      if (stage) q = q.eq('stage', stage)
      else q = q.neq('stage', 'cancelled')

      if (search.trim()) {
        const term = search.trim()
        // Customer names live on another table, so matching ids are resolved first —
        // PostgREST cannot filter a booking by a column of its embedded customer.
        const { data: cust } = await supabase.from('bp_customers')
          .select('id').or(`name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`).limit(200)
        const ids = (cust || []).map((c: any) => c.id)
        const parts = [`booking_no.ilike.%${term}%`, `legacy_booking_no.ilike.%${term}%`]
        if (ids.length) parts.push(`customer_id.in.(${ids.join(',')})`)
        q = q.or(parts.join(','))
      }

      const { data, error, count } = await q.range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error

      const rows = data || []
      const bookingIds = rows.map((b: any) => b.id)
      const { data: pays } = bookingIds.length
        ? await supabase.from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', bookingIds)
        : { data: [] as any[] }
      const paid = paidByBooking(pays as any[])
      return { rows: rows.map((b: any) => toRow(b, paid)), total: count || 0 }
    },
  })
}

/** Customers list, each with how many bookings they hold and what they still owe. */
export function useCustomers(opts: { search: string; page: number }) {
  const { search, page } = opts
  return useQuery({
    queryKey: ['m_customers', search, page],
    queryFn: async () => {
      let q = supabase.from('bp_customers')
        .select('id, name, phone, customer_code, city', { count: 'exact' })
        .order('created_at', { ascending: false })
      if (search.trim()) {
        const term = search.trim()
        q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`)
      }
      const { data, error, count } = await q.range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error

      const custs = data || []
      const ids = custs.map((c: any) => c.id)
      const { data: bks } = ids.length
        ? await supabase.from('bp_bookings')
            .select('id, customer_id, total_amount, plot_total_price, stage')
            .in('customer_id', ids).neq('stage', 'cancelled')
        : { data: [] as any[] }
      const bookingIds = (bks || []).map((b: any) => b.id)
      const { data: pays } = bookingIds.length
        ? await supabase.from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', bookingIds)
        : { data: [] as any[] }
      const paid = paidByBooking(pays as any[])

      const agg: Record<string, { bookings: number; value: number; paid: number }> = {}
      for (const b of (bks || []) as any[]) {
        const a = (agg[b.customer_id] ||= { bookings: 0, value: 0, paid: 0 })
        a.bookings += 1
        a.value += bookingValue(b)
        a.paid += paid[b.id] || 0
      }

      return {
        rows: custs.map((c: any) => {
          const a = agg[c.id] || { bookings: 0, value: 0, paid: 0 }
          return {
            id: c.id, name: c.name || '(no name)', phone: c.phone || null,
            code: c.customer_code || '', city: c.city || null,
            bookings: a.bookings, value: a.value, paid: a.paid,
            balance: balanceOf(a.value, a.paid),
          }
        }),
        total: count || 0,
      }
    },
  })
}

/** One customer's bookings, for their detail screen. */
export function useCustomerBookings(customerId: string | null) {
  return useQuery({
    queryKey: ['m_customer_bookings', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data } = await supabase.from('bp_bookings')
        .select(BOOKING_SELECT).eq('customer_id', customerId!).order('created_at', { ascending: false })
      const rows = data || []
      const ids = rows.map((b: any) => b.id)
      const { data: pays } = ids.length
        ? await supabase.from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', ids)
        : { data: [] as any[] }
      const paid = paidByBooking(pays as any[])
      return rows.map((b: any) => toRow(b, paid))
    },
  })
}

/** Projects with a status breakdown of their plots, for the inventory screen. */
export function useProjects() {
  return useQuery({
    queryKey: ['m_projects'],
    queryFn: async () => {
      const [{ data: projects }, { data: plots }] = await Promise.all([
        supabase.from('bp_projects').select('id, name, location').order('name'),
        // Only the two columns needed to count — pulling whole plot rows for a summary
        // would be several megabytes over mobile data.
        supabase.from('bp_plots').select('project_id, status'),
      ])
      const byProject: Record<string, Record<string, number>> = {}
      for (const p of (plots || []) as any[]) {
        if (!p.project_id) continue
        const m = (byProject[p.project_id] ||= {})
        const k = p.status || 'unknown'
        m[k] = (m[k] || 0) + 1
      }
      return ((projects || []) as any[]).map(p => {
        const c = byProject[p.id] || {}
        const total = Object.values(c).reduce((s: number, n: any) => s + n, 0)
        return {
          id: p.id, name: p.name || '(no name)', location: p.location || null,
          total,
          available: c.available || 0,
          booked: (c.booked || 0) + (c.token || 0),
          registered: c.registry_done || 0,
        }
      })
    },
  })
}

/** Plots inside one project, filtered by status and plot number. */
export function usePlots(projectId: string | null, opts: { search: string; status: string; page: number }) {
  const { search, status, page } = opts
  return useQuery({
    queryKey: ['m_plots', projectId, search, status, page],
    enabled: !!projectId,
    queryFn: async () => {
      let q = supabase.from('bp_plots')
        .select('id, plot_no, size_sqyd, price_per_sqyd, total_price, status, block, sector', { count: 'exact' })
        .eq('project_id', projectId!)
        .order('plot_no')
      if (status) q = q.eq('status', status)
      if (search.trim()) q = q.ilike('plot_no', `%${search.trim()}%`)
      const { data, error, count } = await q.range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      return { rows: data || [], total: count || 0 }
    },
  })
}

/** Who holds a plot, so a plot card can name its buyer instead of just saying "booked". */
export function usePlotHolders(plotIds: string[]) {
  return useQuery({
    queryKey: ['m_plot_holders', plotIds],
    enabled: plotIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('bp_booking_plots')
        .select('plot_id, bp_bookings(id, booking_no, stage, bp_customers(name))')
        .in('plot_id', plotIds)
      const out: Record<string, { bookingId: string; bookingNo: string; name: string }> = {}
      for (const r of (data || []) as any[]) {
        const b = r.bp_bookings
        if (!b || b.stage === 'cancelled') continue
        out[r.plot_id] = {
          bookingId: b.id,
          bookingNo: b.booking_no || '',
          name: b.bp_customers?.name || '(no name)',
        }
      }
      return out
    },
  })
}
