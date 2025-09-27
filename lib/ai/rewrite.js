import { diffWords } from '@/lib/diff/words'

const ENV = (key, fallback) => {
  const value = process.env[key]
  return value !== undefined ? value : fallback
}

const DEFAULT_MODEL = ENV('AI_REWRITE_MODEL', ENV('OPENAI_MODEL', 'gpt-4o-mini'))
const DEFAULT_ENDPOINT = ENV('OPENAI_API_URL', 'https://api.openai.com/v1/chat/completions')
const DEFAULT_TEMPERATURE = Number.parseFloat(ENV('AI_REWRITE_TEMPERATURE', '0.2'))
const DEFAULT_MAX_SEGMENTS = Number.parseInt(
  ENV('AI_REWRITE_MAX_SEGMENTS', ENV('AI_MAX_SEGMENTS', ENV('NEXT_PUBLIC_AI_MAX_SEGMENTS', '80'))),
  10,
)
const MAX_CHAR_DELTA = Number.parseInt(ENV('AI_REWRITE_MAX_CHAR_DELTA', '480'), 10)
const MAX_LENGTH_RATIO = Number.parseFloat(ENV('AI_REWRITE_MAX_LENGTH_RATIO', '3.2'))
const MIN_LENGTH_RATIO = Number.parseFloat(ENV('AI_REWRITE_MIN_LENGTH_RATIO', '0.25'))
const DEFAULT_SELECT_LIMIT = Number.parseInt(ENV('AI_REWRITE_SELECT_LIMIT', '80'), 10)

const clampPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const clampRatio = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const buildAssessmentMessages = ({ projectTitle, language, segments }) => {
  const system = {
    role: 'system',
    content: `You are a senior subtitle editor auditing noisy auto-generated captions.
- Review the entire transcript before making decisions.
- Label every segment with a severity: "major" (severely wrong meaning/words), "minor" (noticeable error but understandable), or "none" (already natural).
- For major issues, imagine how the speaker would actually phrase it and explain the problem briefly.
- Respond only with JSON matching {"segments": [{"index": number, "severity": "none"|"minor"|"major", "reason": string}]}.`,
  }

  const payload = segments.map((segment) => ({ index: segment.index, text: segment.originalText }))

  const user = {
    role: 'user',
    content: `Project title: ${projectTitle || 'Untitled project'}
Language: ${language || 'unknown'}
Full transcript:
${JSON.stringify(payload, null, 2)}

Instructions:
- Inspect every segment.
- Set severity to "none" when you would publish it as-is.
- Provide a short reason highlighting the issue when severity is "minor" or "major".
- Respond with JSON only.`,
  }

  return [system, user]
}

const buildRewriteMessages = ({ projectTitle, language, segments, targetIndices }) => {
  const system = {
    role: 'system',
    content: `You are a senior subtitle editor rewriting the worst auto-caption mistakes.
- Rewrite only the segments whose indices are in target_indices.
- Feel free to add or remove words so the line matches what the speaker most likely said.
- Keep timing intact (one caption per index), but make the sentence sound natural and on-message.
- Respond only with JSON matching {"segments": [{"index": number, "rewrite": string, "confidence": number|null, "notes": string|null}]}.`,
  }

  const payload = segments.map((segment) => ({ index: segment.index, text: segment.originalText }))

  const user = {
    role: 'user',
    content: `Project title: ${projectTitle || 'Untitled project'}
Language: ${language || 'unknown'}
Full transcript (for context):
${JSON.stringify(payload, null, 2)}

target_indices: ${JSON.stringify(targetIndices)}

Instructions:
- Rewrite only the indices listed in target_indices.
- Return JSON only with the segments you changed.`,
  }

  return [system, user]
}

const extractJson = (text) => {
  if (!text) return null
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch (_) {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (err) {
      console.warn('[ai/rewrite] failed to parse JSON chunk', err?.message)
      return null
    }
  }
}

const callOpenAI = async ({ apiKey, endpoint, model, messages, temperature, abortSignal }) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: abortSignal,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`OpenAI request failed (${response.status}): ${details}`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  const json = extractJson(content)
  if (!json || !Array.isArray(json.segments)) {
    throw new Error('OpenAI response missing segments array')
  }

  return json.segments
}

const normalizeSeverity = (value) => {
  if (!value) return 'none'
  const lower = value.toString().toLowerCase()
  if (lower === 'major' || lower === 'minor') return lower
  return 'none'
}

const assessSegments = async ({ apiKey, endpoint, model, temperature, segments, projectTitle, language, signal }) => {
  const messages = buildAssessmentMessages({ projectTitle, language, segments })
  const response = await callOpenAI({ apiKey, endpoint, model, messages, temperature, abortSignal: signal })

  const assessments = new Map()
  for (const item of response) {
    if (!item || typeof item.index !== 'number') continue
    const severity = normalizeSeverity(item.severity)
    const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
    assessments.set(item.index, { severity, reason })
  }
  return assessments
}

const rewriteSelectedSegments = async ({
  apiKey,
  endpoint,
  model,
  temperature,
  projectTitle,
  language,
  segments,
  targetIndices,
  signal,
}) => {
  if (!targetIndices.length) return []
  const messages = buildRewriteMessages({ projectTitle, language, segments, targetIndices })
  return callOpenAI({ apiKey, endpoint, model, messages, temperature, abortSignal: signal })
}

const levenshtein = (a, b) => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i])
  matrix[0] = Array.from({ length: b.length + 1 }, (_, j) => j)

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        )
      }
    }
  }

  return matrix[a.length][b.length]
}

const countChangedCharacters = (diffTokens) =>
  diffTokens.reduce((total, token) => {
    if (token.type === 'equal') return total
    return total + token.value.replace(/\s+/g, '').length
  }, 0)

const hasMeaningfulWordChange = (diffTokens) => {
  for (const token of diffTokens) {
    if (token.type === 'equal') continue
    const compact = token.value.replace(/\s+/g, '')
    if (!compact) continue
    if (/[\p{L}\p{N}]/u.test(compact)) {
      return true
    }
  }
  return false
}

const isRewriteAcceptable = ({ original, rewrite, maxChars, maxRatio, minRatio, diffOverride }) => {
  if (!rewrite) return false

  const trimmedOriginal = (original || '').trim()
  const trimmedRewrite = rewrite.trim()
  if (!trimmedRewrite) return false

  if (trimmedRewrite.toLowerCase() === trimmedOriginal.toLowerCase()) {
    return false
  }

  const diff = diffOverride || diffWords(trimmedOriginal, trimmedRewrite)
  if (!diff.length) return false

  if (!hasMeaningfulWordChange(diff)) {
    return false
  }

  const changedChars = countChangedCharacters(diff)
  if (changedChars > maxChars) {
    const tokensOriginal = trimmedOriginal.split(/\s+/).filter(Boolean)
    const tokensRewrite = trimmedRewrite.split(/\s+/).filter(Boolean)
    const minLength = Math.min(tokensOriginal.length, tokensRewrite.length)
    let compatible = true
    for (let index = 0; index < minLength; index += 1) {
      const a = tokensOriginal[index].toLowerCase()
      const b = tokensRewrite[index].toLowerCase()
      if (a === b) continue
      const distance = levenshtein(a, b)
      const threshold = Math.max(2, Math.ceil(Math.max(a.length, b.length) * 0.6))
      if (distance > threshold) {
        compatible = false
        break
      }
    }
    if (!compatible) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[ai/rewrite] rejecting rewrite due to large char delta', {
          changedChars,
          original: trimmedOriginal,
          rewrite: trimmedRewrite,
        })
      }
      return false
    }
  }

  const originalLength = trimmedOriginal.replace(/\s+/g, ' ').length || 1
  const rewriteLength = trimmedRewrite.replace(/\s+/g, ' ').length || 1
  const ratio = rewriteLength / originalLength

  if (ratio < minRatio || ratio > maxRatio) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[ai/rewrite] rejecting rewrite due to length ratio', {
        ratio,
        original: trimmedOriginal,
        rewrite: trimmedRewrite,
      })
    }
    return false
  }

  if (changedChars <= 2 && ratio > 0.95 && ratio < 1.05) {
    return false
  }

  return true
}

const classifySeverity = ({ diff, original, rewrite }) => {
  const trimmedOriginal = (original || '').trim()
  const trimmedRewrite = (rewrite || '').trim()
  if (!trimmedOriginal || !trimmedRewrite) return 'minor'

  const originalWords = trimmedOriginal.split(/\s+/).filter(Boolean)
  const rewriteWords = trimmedRewrite.split(/\s+/).filter(Boolean)
  const changedChars = countChangedCharacters(diff)
  const wordDelta = Math.abs(rewriteWords.length - originalWords.length)
  const ratio = (rewriteWords.length || 1) / (originalWords.length || 1)

  if (changedChars > 45 || wordDelta >= 2 || ratio < 0.65 || ratio > 1.45) {
    return 'major'
  }

  return 'minor'
}

export async function generateRewriteSuggestions({
  segments,
  projectTitle,
  language,
  signal,
} = {}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[ai/rewrite] OPENAI_API_KEY missing; skipping rewrites')
    return new Map()
  }

  if (!Array.isArray(segments) || segments.length === 0) {
    return new Map()
  }

  const maxSegments = clampPositiveInt(DEFAULT_MAX_SEGMENTS, 120)
  const workingSegments = segments.slice(0, maxSegments)

  const endpoint = DEFAULT_ENDPOINT
  const model = DEFAULT_MODEL
  const temperature = Number.isFinite(DEFAULT_TEMPERATURE) ? DEFAULT_TEMPERATURE : 0.2
  const maxChars = clampPositiveInt(MAX_CHAR_DELTA, 180)
  const maxRatio = clampRatio(MAX_LENGTH_RATIO, 1.9)
  const minRatio = clampRatio(MIN_LENGTH_RATIO, 0.35)
  const selectLimit = clampPositiveInt(DEFAULT_SELECT_LIMIT, 120)

  const assessments = await assessSegments({
    apiKey,
    endpoint,
    model,
    temperature,
    segments: workingSegments,
    projectTitle,
    language,
    signal,
  })

  const candidateIndices = workingSegments
    .map((segment) => {
      const assessment = assessments.get(segment.index) || { severity: 'none', reason: '' }
      return {
        index: segment.index,
        severity: assessment.severity,
        reason: assessment.reason,
      }
    })
    .filter(({ severity }) => severity !== 'none')

  if (!candidateIndices.length) {
    return new Map()
  }

  const severityScore = (value) => {
    if (value === 'major') return 2
    if (value === 'minor') return 1
    return 0
  }

  const rankedCandidates = candidateIndices
    .sort((a, b) => severityScore(b.severity) - severityScore(a.severity))
    .slice(0, selectLimit)

  const targetIndices = rankedCandidates.map((item) => item.index)
  const rewriteResponses = await rewriteSelectedSegments({
    apiKey,
    endpoint,
    model,
    temperature,
    projectTitle,
    language,
    segments: workingSegments,
    targetIndices,
    signal,
  })

  const rewrites = new Map()

  for (const item of rewriteResponses) {
    if (!item || typeof item.index !== 'number') continue
    const rewrite = typeof item.rewrite === 'string' ? item.rewrite.trim() : ''
    if (!rewrite) continue

    const segment = workingSegments.find((entry) => entry.index === item.index)
    if (!segment) continue

    const diff = diffWords(segment.originalText || '', rewrite)

    if (!isRewriteAcceptable({
      original: segment.originalText,
      rewrite,
      maxChars,
      maxRatio,
      minRatio,
      diffOverride: diff,
    })) {
      continue
    }

    const confidence = typeof item.confidence === 'number'
      ? Math.min(Math.max(item.confidence, 0), 1)
      : null

    const fallbackSeverity = classifySeverity({ diff, original: segment.originalText, rewrite })
    const assessment = assessments.get(item.index)
    const severity = assessment?.severity || fallbackSeverity
    const reason = assessment?.reason || ''

    const notesFromModel = typeof item.notes === 'string' ? item.notes.trim() : ''
    const notes = notesFromModel || reason

    rewrites.set(item.index, {
      rewrite,
      confidence,
      notes: notes || null,
      severity,
    })
  }

  return rewrites
}

export default generateRewriteSuggestions
