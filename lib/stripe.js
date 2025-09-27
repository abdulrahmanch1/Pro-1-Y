import Stripe from 'stripe'

let stripeClient = null
let initialized = false

const initializeStripe = () => {
  if (initialized) {
    return stripeClient
  }

  initialized = true
  const secret = process.env.STRIPE_SECRET_KEY

  if (!secret) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[stripe] STRIPE_SECRET_KEY is not configured. Stripe features are disabled.')
    }
    stripeClient = null
    return stripeClient
  }

  stripeClient = new Stripe(secret, {
    apiVersion: '2024-06-20',
    typescript: false,
  })

  return stripeClient
}

export const getStripeClient = () => initializeStripe()

export default getStripeClient
