export const PAYOUT_STATUS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hold', label: 'Hold' },
]
export const PAYOUT_STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  hold: 'bg-orange-100 text-orange-800',
}
export const STAGE_COLORS = {
  token: 'bg-yellow-100 text-yellow-800',
  booking: 'bg-blue-100 text-blue-800',
  full_payment: 'bg-purple-100 text-purple-800',
  registry_done: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}
export const PLOT_STATUS_COLORS = {
  available: 'bg-green-100 text-green-800',
  token: 'bg-yellow-100 text-yellow-800',
  booked: 'bg-blue-100 text-blue-800',
  registry_done: 'bg-purple-100 text-purple-800',
  blocked: 'bg-red-100 text-red-800',
}