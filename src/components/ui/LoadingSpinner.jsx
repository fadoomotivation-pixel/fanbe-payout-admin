export default function LoadingSpinner({ fullPage = false }) {
  if (fullPage) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
    </div>
  )
  return <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600" />
}