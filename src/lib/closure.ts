import { supabase } from '@/lib/supabase'

export type ClosureEntity = 'booking' | 'cycle' | 'withdrawal'

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id || null
}

export async function logClosure(opts: {
  entityType: ClosureEntity
  entityId: string
  action: 'closed' | 'reopened'
  reason?: string | null
  metadata?: Record<string, any>
}): Promise<string | null> {
  const userId = await getCurrentUserId()
  await supabase.from('closure_audit').insert({
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    action: opts.action,
    performed_by: userId,
    reason: opts.reason || null,
    metadata: opts.metadata || null,
  })
  return userId
}

export async function fetchClosureHistory(entityType: ClosureEntity, entityId: string) {
  const { data, error } = await supabase
    .from('closure_audit')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('performed_at', { ascending: false })
  if (error) throw error
  return data || []
}

export function monthRange(d: Date = new Date()): { start: string; end: string; label: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const fmt = (x: Date) => x.toISOString().slice(0, 10)
  const label = d.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  return { start: fmt(start), end: fmt(end), label }
}
