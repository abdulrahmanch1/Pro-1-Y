import { diffWords } from '@/lib/diff/words'

const ENV = (key, fallback) => {
  const value = process.env[key]
  return value !== undefined ? value : fallback
}

const DEFAULT_MODEL = ENV('AI_REWRITE_MODEL', ENV('OPENAI_MODEL', 'gpt-4o-mini'))
const DEFAULT_ENDPOINT = ENV('OPENAI_API_URL', 'https://api.openai.com/v1/chat/completions')
const DEFAULT_TEMPERATURE = Number.parseFloat(ENV('AI_REWRITE_TEMPERATURE', '0.2'))
const DEFAULT_BATCH_SIZE = Number.parseInt(ENV('AI_REWRITE_BATCH_SIZE', '4'), 10)
const DEFAULT_MAX_SEGMENTS = Number.parseInt(
  ENV('AI_REWRITE_MAX_SEGMENTS', ENV('AI_MAX_SEGMENTS', ENV('NEXT_PUBLIC_AI_MAX_SEGMENTS', '80'))),
  10,
)
const MAX_CHAR_DELTA = Number.parseInt(ENV('AI_REWRITE_MAX_CHAR_DELTA', '480'), 10)
const MAX_LENGTH_RATIO = Number.parseFloat(ENV('AI_REWRITE_MAX_LENGTH_RATIO', '3.2'))
const MIN_LENGTH_RATIO = Number.parseFloat(ENV('AI_REWRITE_MIN_LENGTH_RATIO', '0.25'))

const clampPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const clampRatio = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const chunkSegments = (segments, size) => {
  if (!Array.isArray(segments) || !segments.length) return []
  const chunkSize = clampPositiveInt(size, 6)
  const buckets = []
  for (let index = 0; index < segments.length; index += chunkSize) {
    buckets.push(segments.slice(index, index + chunkSize))
  }
  return buckets
}

const buildMessages = ({ projectTitle, language, segments }) => {
  const system = {
    role: 'system',
    content: `You are a senior subtitle editor finishing captions before a video goes live.
- Rewrite every supplied line so it sounds natural, fluent, and context-appropriate for spoken dialogue.
- When a line is garbled, repetitive, or nonsensical, infer the most likely intent and produce a clean sentence even if you must introduce new words.
- Remove filler, duplicated words, obvious misspellings, and translate phonetic noise into meaningful phrases.
- Fix grammar, punctuation, capitalization, and ensure the sentence would pass a native-speaker review.
- Preserve clear speaker intent and key proper nouns whenever they can be inferred; otherwise choose safe, professional wording.
- Keep each line concise (generally under 20 words) and avoid slang unless the line obviously requires it.
- Return only JSON matching: {"segments": [{"index": number, "rewrite": string, "confidence": number, "notes": string|null}]}
- Skip segments only when no improvement is genuinely needed.
- Do not add timestamps, numbering, or commentary.`,
  }

  const payload = segments.map((segment) => ({
    index: segment.index,
    text: segment.originalText,
  }))

  const user = {
    role: 'user',
    content: `Project title: ${projectTitle || 'Untitled project'}
Language: ${language || 'unknown'}
Segments needing polish:
${JSON.stringify(payload, null, 2)}
Respond with JSON only.`,
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

const isRewriteAcceptable = ({ original, rewrite, maxChars, maxRatio, minRatio }) => {
  if (!rewrite) return false

  const trimmedOriginal = (original || '').trim()
  const trimmedRewrite = rewrite.trim()
  if (!trimmedRewrite) return false

  if (trimmedRewrite.toLowerCase() === trimmedOriginal.toLowerCase()) {
    return false
  }

  const diff = diffWords(trimmedOriginal, trimmedRewrite)
  if (!diff.length) return false

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

  return true
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

  if (process.env.NODE_ENV === 'development' && workingSegments.length !== segments.length) {
    console.log('[ai/rewrite] limiting segments for rewrites', {
      requested: segments.length,
      processed: workingSegments.length,
    })
  }

  const endpoint = DEFAULT_ENDPOINT
  const model = DEFAULT_MODEL
  const temperature = Number.isFinite(DEFAULT_TEMPERATURE) ? DEFAULT_TEMPERATURE : 0.2
  const batchSize = clampPositiveInt(DEFAULT_BATCH_SIZE, 6)
  const maxChars = clampPositiveInt(MAX_CHAR_DELTA, 180)
  const maxRatio = clampRatio(MAX_LENGTH_RATIO, 1.9)
  const minRatio = clampRatio(MIN_LENGTH_RATIO, 0.35)

  const chunks = chunkSegments(workingSegments, batchSize)
  const rewrites = new Map()

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]

    if (process.env.NODE_ENV === 'development') {
      console.log('[ai/rewrite] generating rewrite chunk', {
        chunkIndex,
        chunkSize: chunk.length,
        totalChunks: chunks.length,
      })
    }

    let result
    try {
      const messages = buildMessages({ projectTitle, language, segments: chunk })
      result = await callOpenAI({ apiKey, endpoint, model, messages, temperature, abortSignal: signal })
    } catch (error) {
      console.error('[ai/rewrite] OpenAI call failed', {
        chunkIndex,
        message: error?.message,
      })
      continue
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[ai/rewrite] received rewrite chunk', {
        chunkIndex,
        received: Array.isArray(result) ? result.length : 0,
      })
    }

    for (const item of result) {
      if (!item || typeof item.index !== 'number') continue
      const rewrite = typeof item.rewrite === 'string' ? item.rewrite.trim() : ''
      if (!rewrite) continue

      const segment = chunk.find((entry) => entry.index === item.index)
      if (!segment) continue

      if (!isRewriteAcceptable({
        original: segment.originalText,
        rewrite,
        maxChars,
        maxRatio,
        minRatio,
      })) {
        continue
      }

      const confidence = typeof item.confidence === 'number'
        ? Math.min(Math.max(item.confidence, 0), 1)
        : null

      rewrites.set(item.index, {
        rewrite,
        confidence,
        notes: typeof item.notes === 'string' ? item.notes.trim() || null : null,
      })
    }
  }

  return rewrites
}

export default generateRewriteSuggestions
