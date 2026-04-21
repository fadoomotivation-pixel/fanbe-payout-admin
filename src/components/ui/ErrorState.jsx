import { AlertCircle } from 'lucide-react'
export default function ErrorState({ message = 'Something went wrong', onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertCircle size={32} className="text-red-400 mb-3" />
      <p className="text-sm text-slate-600">{message}</p>
      {onRetry && <button onClick={onRetry} className="btn-secondary mt-4">Try Again</button>}
    </div>
  )
}