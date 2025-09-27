'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { loadStripe } from '@stripe/stripe-js'

import { EXPORT_COST_CENTS } from '@/lib/pricing'

const formatCurrency = (cents) => `${(Number(cents || 0) / 100).toFixed(2)}`

const formatDate = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return date.toLocaleDateString()
}

// Lazily load the Stripe instance
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

export default function WalletClient({ balanceCents, availableCents, pendingDebitsCents = 0, transactions }) {
  const [balance, setBalance] = useState(balanceCents)
  const [available, setAvailable] = useState(availableCents ?? balanceCents)
  const [pendingDebits, setPendingDebits] = useState(pendingDebitsCents)
  const [items, setItems] = useState(transactions)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState('')

  const searchParams = useSearchParams();

  useEffect(() => {
    setBalance(balanceCents)
    setAvailable(availableCents ?? balanceCents)
    setPendingDebits(pendingDebitsCents)
    setItems(transactions)
  }, [balanceCents, availableCents, pendingDebitsCents, transactions])

  useEffect(() => {
    if (searchParams.get('payment_success')) {
      setSuccessMessage('Payment successful! Your balance has been updated.');
    }
    if (searchParams.get('payment_canceled')) {
      setError('Payment was canceled.');
    }
  }, [searchParams]);

  const topUp = async (amount) => {
    setLoading(true)
    setError(null)
    setSuccessMessage('')

    try {
      const response = await fetch('/api/wallet/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to create payment session.');
      }

      const { sessionId } = await response.json();
      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe.js is not loaded.');

      const { error } = await stripe.redirectToCheckout({ sessionId });

      if (error) {
        throw new Error(error.message);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <section className="section wallet-section">
      <div className="section-header">
        <span className="eyebrow">Wallet</span>
        <h2>Monitor credits, top up instantly, and track every export.</h2>
        <p>Your wallet fuels AI reviews and downloads. Recharge in one tap and see exactly where funds go.</p>
      </div>

      <div className="wallet-grid" style={{marginTop:'2rem'}}>
        <div className="wallet-card" style={{gridColumn:'1 / -1'}}>
          <span className="tag tag--primary">Balance</span>
          <div className="wallet-balance mt-2">{formatCurrency(available)}</div>
          <p className="wallet-emphasis">
            Enough balance for {EXPORT_COST_CENTS > 0 ? (available / EXPORT_COST_CENTS).toFixed(1) : '—'} exports at ${
              (EXPORT_COST_CENTS / 100).toFixed(2)
            } each.
          </p>
          {pendingDebits > 0 ? (
            <p className="upload-hint">{`Pending holds: -${formatCurrency(pendingDebits)}, ledger total: ${formatCurrency(balance)}`}</p>
          ) : null}
          <div className="wallet-quick">
            {[5, 10, 50, 100].map((value) => (
              <button
                key={value}
                type="button"
                className="wallet-chip"
                onClick={() => topUp(value)}
                disabled={loading}
              >
                + ${value}
              </button>
            ))}
          </div>
          <div className="flex" style={{justifyContent:'flex-start'}}>
            <button className="btn btn-primary" type="button" onClick={() => topUp(25)} disabled={loading}>
              {loading ? 'Processing…' : 'Add funds'}
            </button>
            <button className="btn btn-ghost" type="button" disabled>
              Set auto top-up
            </button>
          </div>
          {error ? (
            <div className="alert alert-error mt-3">
              <span>{error}</span>
            </div>
          ) : null}
          {successMessage ? (
            <div className="alert alert-success mt-3">
              <span>{successMessage}</span>
            </div>
          ) : null}
        </div>

        <div className="card card--stretch" style={{gridColumn:'1 / -1'}}>
          <span className="tag">Transactions</span>
          <table className="table mt-3">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((transaction) => (
                <tr key={transaction.id}>
                  <td data-label="Date">{formatDate(transaction.created_at)}</td>
                  <td data-label="Type">{transaction.type === 'charge' ? 'Caption export' : 'Top up'}</td>
                  <td data-label="Amount">{formatCurrency(transaction.amount_cents)}</td>
                  <td data-label="Status"><span className="badge badge--ok">{transaction.status}</span></td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={4} style={{textAlign:'center', padding:'1rem'}}>No transactions yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
