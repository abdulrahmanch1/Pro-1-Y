import { describe, expect, it } from 'vitest'

import { computeBalance, computePendingDebits } from '@/lib/utils/wallet'

describe('wallet utils', () => {
  const sample = [
    { amount_cents: 1000, status: 'succeeded' },
    { amount_cents: 5000, status: 'succeeded' },
    { amount_cents: -2000, status: 'succeeded' },
    { amount_cents: -1500, status: 'pending' },
    { amount_cents: 3000, status: 'pending' },
  ]

  it('computes balance from succeeded transactions including charges', () => {
    expect(computeBalance(sample)).toBe(4000)
  })

  it('computes total pending debits only for pending negative amounts', () => {
    expect(computePendingDebits(sample)).toBe(1500)
  })
})
