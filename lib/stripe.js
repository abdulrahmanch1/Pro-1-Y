import Stripe from 'stripe';

const invariant = (value, message) => {
  if (!value) throw new Error(message)
  return value
}

const stripeSecretKey = invariant(
  process.env.STRIPE_SECRET_KEY,
  'Stripe secret key is not configured. Please set STRIPE_SECRET_KEY.'
);

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2024-06-20',
  typescript: false,
});
