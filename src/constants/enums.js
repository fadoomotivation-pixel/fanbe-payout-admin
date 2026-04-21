export const BOOKING_STAGES = [
  { value: 'token', label: 'Token' },
  { value: 'booking', label: 'Booking' },
  { value: 'full_payment', label: 'Full Payment' },
  { value: 'registry_done', label: 'Registry Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const COMMISSION_STATUS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'hold', label: 'Hold' },
]

export const PAYOUT_TYPES = [
  { value: 'commission', label: 'Commission' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'bonanza', label: 'Bonanza' },
  { value: 'level_commission', label: 'Level Commission' },
  { value: 'adjustment', label: 'Adjustment' },
]

export const PAYOUT_STATUS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hold', label: 'Hold' },
]

export const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'upi', label: 'UPI' },
  { value: 'dd', label: 'DD' },
]

export const PAYMENT_TYPES = [
  { value: 'token', label: 'Token' },
  { value: 'booking_amount', label: 'Booking Amount' },
  { value: 'installment', label: 'Installment' },
  { value: 'full_payment', label: 'Full Payment' },
  { value: 'extra', label: 'Extra' },
]

export const PLOT_STATUS = [
  { value: 'available', label: 'Available', color: 'green' },
  { value: 'token', label: 'Token', color: 'yellow' },
  { value: 'booked', label: 'Booked', color: 'blue' },
  { value: 'registry_done', label: 'Registry Done', color: 'purple' },
  { value: 'cancelled', label: 'Cancelled', color: 'red' },
  { value: 'hold', label: 'Hold', color: 'orange' },
]

export const BROKER_RANKS = [
  { value: 'associate', label: 'Associate' },
  { value: 'senior', label: 'Senior' },
  { value: 'master', label: 'Master' },
  { value: 'director', label: 'Director' },
]

export const BROKER_STATUS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'pending', label: 'Pending' },
  { value: 'blocked', label: 'Blocked' },
]

export const STAGE_COLORS = {
  token: 'bg-yellow-100 text-yellow-800',
  booking: 'bg-blue-100 text-blue-800',
  full_payment: 'bg-green-100 text-green-800',
  registry_done: 'bg-purple-100 text-purple-800',
  cancelled: 'bg-red-100 text-red-800',
}

export const PAYOUT_STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  hold: 'bg-orange-100 text-orange-800',
}

export const PLOT_STATUS_COLORS = {
  available: 'bg-green-100 text-green-800',
  token: 'bg-yellow-100 text-yellow-800',
  booked: 'bg-blue-100 text-blue-800',
  registry_done: 'bg-purple-100 text-purple-800',
  cancelled: 'bg-red-100 text-red-800',
  hold: 'bg-orange-100 text-orange-800',
}
