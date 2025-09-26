const fallback = 500

const parsed = Number.parseInt(process.env.EXPORT_COST_CENTS ?? '', 10)

export const EXPORT_COST_CENTS = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback

export default {
  EXPORT_COST_CENTS,
}
