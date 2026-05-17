import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Textarea } from '@/components/ui/Input.tsx'
import { AlertTriangle, Lock, Unlock } from 'lucide-react'

type Props = {
  open: boolean
  action: 'close' | 'reopen'
  entityLabel: string
  description?: string
  reasonRequired?: boolean
  warning?: string
  onClose: () => void
  onConfirm: (reason: string) => Promise<void> | void
  submitting?: boolean
}

export function ClosureDialog({ open, action, entityLabel, description, reasonRequired, warning, onClose, onConfirm, submitting }: Props) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setReason('') }, [open])

  const isClose = action === 'close'
  const title = `${isClose ? 'Close' : 'Reopen'} ${entityLabel}`
  const Icon  = isClose ? Lock : Unlock
  const btnVariant = isClose ? undefined : 'secondary'
  const btnText = isClose ? 'Confirm Close' : 'Reopen'
  const placeholder = isClose
    ? 'Optional — any notes the audit log should capture'
    : 'Required — why are you reopening this?'
  const blocked = !!reasonRequired && !reason.trim()

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className={`rounded-lg p-3 mb-4 text-sm flex items-start gap-2 ${isClose ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-blue-50 text-blue-900 border border-blue-200'}`}>
        <Icon size={16} className="mt-0.5 shrink-0" />
        <div>
          {description || (isClose
            ? 'Closing locks this record. After close, edits are blocked until someone reopens it with a reason.'
            : 'Reopening unlocks the record so it can be edited again. The reason will appear in the audit log.')}
          {warning && <div className="mt-1.5 flex items-start gap-1.5 text-red-800"><AlertTriangle size={13} className="mt-0.5 shrink-0"/><span>{warning}</span></div>}
        </div>
      </div>

      <Textarea
        label={isClose ? 'Closure notes' : 'Reason for reopen'}
        value={reason}
        onChange={(e: any) => setReason(e.target.value)}
        placeholder={placeholder}
        rows={3}
      />

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant={btnVariant as any}
          onClick={() => onConfirm(reason.trim())}
          loading={submitting}
          disabled={blocked}
        >
          {btnText}
        </Button>
      </div>
    </Modal>
  )
}
