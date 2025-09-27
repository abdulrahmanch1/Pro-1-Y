export const computeBalance = (transactions = []) =>
  transactions
    .filter((tx) => tx.status === 'succeeded')
    .reduce((acc, tx) => acc + Number(tx.amount_cents || 0), 0)

export const computePendingDebits = (transactions = []) =>
  transactions
    .filter((tx) => tx.status === 'pending' && Number(tx.amount_cents || 0) < 0)
    .reduce((acc, tx) => acc + Math.abs(Number(tx.amount_cents || 0)), 0)

const walletUtils = {
  computeBalance,
  computePendingDebits,
}

export default walletUtils
