const fallback = 500

const parsedExport = Number.parseInt(process.env.EXPORT_COST_CENTS ?? '', 10)
const parsedUpload = Number.parseInt(process.env.UPLOAD_COST_CENTS ?? '', 10)

export const EXPORT_COST_CENTS = Number.isFinite(parsedExport) && parsedExport > 0 ? parsedExport : fallback
export const UPLOAD_COST_CENTS = Number.isFinite(parsedUpload) && parsedUpload > 0 ? parsedUpload : fallback

export default {
  EXPORT_COST_CENTS,
  UPLOAD_COST_CENTS,
}
