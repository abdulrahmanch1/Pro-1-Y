'use client'

import { useState } from 'react'

const formatCurrency = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`

const formatDate = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return date.toLocaleDateString()
}

export default function WalletClient({ balanceCents, transactions }) {
  const [balance, setBalance] = useState(balanceCents)
  const [items, setItems] = useState(transactions)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const topUp = async (amount) => {
    setLoading(true)
    setError(null)
    const response = await fetch('/api/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })

    setLoading(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setError(payload.error || 'Unable to add funds right now.')
      return
    }

    const payload = await response.json()
    const transaction = payload.transaction
    setItems((prev) => [transaction, ...prev])
    setBalance((prev) => prev + Number(transaction.amount_cents || 0))
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
          <div className="wallet-balance mt-2">{formatCurrency(balance)}</div>
          <p className="wallet-emphasis">Enough credits for {(balance / 100).toFixed(0)} AI-enhanced exports. Auto-top ups are coming soon.</p>
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
                  <td>{formatDate(transaction.created_at)}</td>
                  <td>{transaction.type === 'charge' ? 'Caption export' : 'Top up'}</td>
                  <td>{formatCurrency(transaction.amount_cents)}</td>
                  <td><span className="badge badge--ok">{transaction.status}</span></td>
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
