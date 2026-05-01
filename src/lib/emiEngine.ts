// EMI engine: generates installment schedules for property bookings.
// Supports monthly / quarterly / half-yearly / annual frequencies, flat & reducing-balance interest,
// late fees, cheque-bounce charges, partial payments and prepayment.

export type EmiFrequency = 'monthly' | 'quarterly' | 'half_yearly' | 'annual'
export type InterestMethod = 'flat' | 'reducing'

export interface EmiInput {
  principal: number
  numInstallments: number
  startDate: string | Date
  frequency: EmiFrequency
  interestRatePct?: number      // annual %
  interestMethod?: InterestMethod
}

export interface EmiInstallment {
  seq: number
  dueDate: string
  amount: number
  principalComponent: number
  interestComponent: number
  outstanding: number
}

export interface EmiSchedule {
  totalPayable: number
  totalInterest: number
  installmentAmount: number
  installments: EmiInstallment[]
}

const MONTHS_PER_PERIOD: Record<EmiFrequency, number> = {
  monthly: 1, quarterly: 3, half_yearly: 6, annual: 12,
}

function addMonths(d: Date, months: number): Date {
  const x = new Date(d)
  x.setMonth(x.getMonth() + months)
  return x
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

export function generateEmiSchedule(input: EmiInput): EmiSchedule {
  const principal = +input.principal
  const n = Math.max(1, Math.floor(input.numInstallments))
  const rate = (input.interestRatePct ?? 0) / 100
  const method = input.interestMethod ?? 'flat'
  const monthsPer = MONTHS_PER_PERIOD[input.frequency]
  const start = new Date(input.startDate)

  let installments: EmiInstallment[] = []
  let totalInterest = 0

  if (rate === 0) {
    const each = round2(principal / n)
    let remaining = principal
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1 ? round2(remaining) : each
      remaining = round2(remaining - amount)
      installments.push({
        seq: i + 1,
        dueDate: addMonths(start, monthsPer * i).toISOString().slice(0, 10),
        amount,
        principalComponent: amount,
        interestComponent: 0,
        outstanding: remaining,
      })
    }
  } else if (method === 'flat') {
    // Flat: interest on full principal across full tenure (years).
    const tenureYears = (n * monthsPer) / 12
    const totInt = round2(principal * rate * tenureYears)
    const each = round2((principal + totInt) / n)
    const principalEach = round2(principal / n)
    const interestEach = round2(totInt / n)
    let remaining = principal
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1
        ? round2(principal + totInt - each * (n - 1))
        : each
      remaining = round2(remaining - principalEach)
      installments.push({
        seq: i + 1,
        dueDate: addMonths(start, monthsPer * i).toISOString().slice(0, 10),
        amount,
        principalComponent: i === n - 1 ? round2(principal - principalEach * (n - 1)) : principalEach,
        interestComponent: i === n - 1 ? round2(totInt - interestEach * (n - 1)) : interestEach,
        outstanding: Math.max(0, remaining),
      })
    }
    totalInterest = totInt
  } else {
    // Reducing-balance EMI formula on per-period rate.
    const periodRate = (rate * monthsPer) / 12
    const factor = Math.pow(1 + periodRate, n)
    const emi = (principal * periodRate * factor) / (factor - 1)
    let bal = principal
    for (let i = 0; i < n; i++) {
      const interestComp = bal * periodRate
      const principalComp = emi - interestComp
      bal = bal - principalComp
      totalInterest += interestComp
      installments.push({
        seq: i + 1,
        dueDate: addMonths(start, monthsPer * i).toISOString().slice(0, 10),
        amount: round2(emi),
        principalComponent: round2(principalComp),
        interestComponent: round2(interestComp),
        outstanding: round2(Math.max(0, bal)),
      })
    }
    totalInterest = round2(totalInterest)
  }

  const totalPayable = round2(installments.reduce((s, i) => s + i.amount, 0))
  const installmentAmount = installments[0]?.amount ?? 0
  return { totalPayable, totalInterest, installmentAmount, installments }
}

export interface LateFeeInput {
  dueDate: string | Date
  amount: number
  paidOn?: string | Date
  graceDays?: number
  perDayPct?: number      // e.g. 0.05 = 0.05% per day late
  flatLateFee?: number    // alternative: flat fee
}

export function computeLateFee(i: LateFeeInput): number {
  const due = new Date(i.dueDate).getTime()
  const on = new Date(i.paidOn ?? new Date()).getTime()
  const grace = (i.graceDays ?? 0) * 86400000
  const lateMs = on - due - grace
  if (lateMs <= 0) return 0
  const days = Math.ceil(lateMs / 86400000)
  if (i.flatLateFee != null) return round2(i.flatLateFee)
  const pct = (i.perDayPct ?? 0) / 100
  return round2(i.amount * pct * days)
}

export function applyPayment(
  installment: EmiInstallment & { paidAmount?: number; lateFee?: number; bounceCharge?: number },
  payAmount: number,
) {
  const due = installment.amount + (installment.lateFee ?? 0) + (installment.bounceCharge ?? 0)
  const already = installment.paidAmount ?? 0
  const remaining = Math.max(0, due - already)
  const applied = Math.min(payAmount, remaining)
  const newPaid = round2(already + applied)
  return {
    applied: round2(applied),
    newPaid,
    fullyPaid: newPaid + 0.001 >= due,
    overflow: round2(payAmount - applied),
  }
}
