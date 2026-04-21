import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatINR(amount) {
  if (!amount && amount !== 0) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

export function formatDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(date) {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
}

export const KYC_COLORS = {
  pending:   'bg-yellow-100 text-yellow-700',
  submitted: 'bg-blue-100 text-blue-700',
  verified:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
}

export const PAYOUT_STATUS_COLORS = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  paid:     'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  hold:     'bg-orange-100 text-orange-700',
}

export const BOOKING_STATUS_COLORS = {
  draft:     'bg-slate-100 text-slate-600',
  confirmed: 'bg-blue-100 text-blue-700',
  active:    'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-teal-100 text-teal-700',
}

export const PLOT_STATUS_COLORS = {
  available: 'bg-green-100 text-green-700',
  booked:    'bg-blue-100 text-blue-700',
  sold:      'bg-slate-100 text-slate-600',
  reserved:  'bg-yellow-100 text-yellow-700',
  blocked:   'bg-red-100 text-red-700',
}
