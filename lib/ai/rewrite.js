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
const DEFAULT_DIAG_BATCH_SIZE = Number.parseInt(ENV('AI_DIAG_BATCH_SIZE', '40'), 10)
const DEFAULT_MIN_SELECT = Number.parseInt(ENV('AI_REWRITE_MIN_SELECT', '25'), 10)

const clampPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const clampRatio = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const buildDiagnosisMessages = ({ projectTitle, language, focusSegments, heuristics }) => {
  const system = {
    role: 'system',
    content: `You are a senior subtitle editor auditing noisy auto captions.
- Review the entire transcript before acting so you understand context and tone.
- For each segment, decide the severity of issues: "major" (clearly wrong words/meaning), "minor" (noticeable error but understandable), or "none" (already publishable).
- Provide a short reason describing the most salient issue.
- Include a numeric confidence score between 0 and 1 for your severity judgement.
- Respond only with JSON matching {"segments": [{"index": number, "severity": "none"|"minor"|"major", "reason": string, "confidence": number}]}.`,
  }

  const payload = focusSegments.map((segment) => ({ index: segment.index, text: segment.originalText }))
  const hints = heuristics
    .map(({ index, hints }) => ({ index, hints }))
    .filter(({ hints }) => hints.length)

  const user = {
    role: 'user',
    content: `Project title: ${projectTitle || 'Untitled project'}
Language: ${language || 'unknown'}
Focused excerpt (noisy auto captions):
${JSON.stringify(payload, null, 2)}

Heuristic hints (possible issues to double-check):
${JSON.stringify(hints, null, 2)}

Instructions:
- Inspect every segment and classify severity.
- Set severity to "none" when you would publish it as-is.
- Provide a short reason explaining the issue for "minor" or "major" severities.
- Return JSON only.`,
  }

  return [system, user]
}

const buildRewriteMessages = ({ projectTitle, language, segments, targets }) => {
  const system = {
    role: 'system',
    content: `You are a senior subtitle editor rewriting the worst auto-caption mistakes.
- Rewrite only the segments whose indices are listed in target_overview.
- Treat the captions as noisy speech-to-text: fix misheard words, missing phrases, and grammar so the line sounds exactly like the speaker intended.
- You may rewrite the whole sentence, add or remove words, or merge phrases as needed while preserving the speaker's meaning.
- Respond only with JSON matching {"segments": [{"index": number, "rewrite": string, "confidence": number|null, "notes": string|null}]}.`,
  }

  const payload = segments.map((segment) => ({ index: segment.index, text: segment.originalText }))
  const targetOverview = targets.map(({ index, severity, reason }) => ({ index, severity, reason }))

  const user = {
    role: 'user',
    content: `Project title: ${projectTitle || 'Untitled project'}
Language: ${language || 'unknown'}
Full transcript (noisy auto captions):
${JSON.stringify(payload, null, 2)}

target_overview:
${JSON.stringify(targetOverview, null, 2)}

Instructions:
- Rewrite only the listed indices and return JSON with the segments you changed.
- When severity is "major", feel free to rewrite the entire sentence from scratch so it matches the speaker's real intent.
- Use the provided reason as guidance (e.g. remove wrong words, fix misunderstanding, replace guessed terms).
- When severity is "minor", fix the issue surgically but keep the line natural.
- If a rewrite requires inserting or deleting words, do so confidently.`,
  }

  return [system, user]
}

const buildPrioritizationMessages = ({ projectTitle, language, segmentsSummary, maxCount }) => {
  const system = {
    role: 'system',
    content: `You are a senior subtitle editor prioritising which captions need fixes first.
- Given a severity report for each index, pick the indices that must be rewritten urgently.
- Output indices sorted from highest to lowest priority.
- Consider severity (major > minor > none), confidence, and the brief reason provided.
- You may include at most ${maxCount} indices.
- Respond only with JSON matching {"indices": [number, ...]}.`,
  }

  const user = {
    role: 'user',
    content: `Project title: ${projectTitle || 'Untitled project'}
Language: ${language || 'unknown'}
Severity report:
${JSON.stringify(segmentsSummary, null, 2)}

Instructions:
- Return the ordered list of indices you consider highest priority (max ${maxCount}).`,
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

const chunkArray = (items, size) => {
  if (!Array.isArray(items) || !items.length) return []
  const chunkSize = clampPositiveInt(size, 40)
  const chunks = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

const tokenize = (text = '') => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const heuristicIssues = (segment) => {
  const issues = []
  const original = segment.originalText || ''
  const trimmed = original.trim()

  const hasWeirdChars = /[\u0400-\u04FF]|[\u0600-\u06FF]/.test(trimmed)
  if (hasWeirdChars && /[A-Za-z]/.test(trimmed)) {
    issues.push('Mixed scripts detected (Latin + non-Latin)')
  }

  if (/pkt|knit\.pi|kit\.pi/i.test(trimmed)) {
    issues.push('Possible mistyped Python file name (e.g. __init__.py)')
  }

  const words = tokenize(trimmed)
  const repeated = words.some((word, index) => word.length > 3 && word === words[index + 1])
  if (repeated) {
    issues.push('Repeated word suggesting transcription glitch')
  }

  if (/a\s+kit/i.test(trimmed)) {
    issues.push('Possible case typo around “kit”')
  }

  return issues
}

const callOpenAI = async ({ apiKey, endpoint, model, messages, temperature, abortSignal, responseKey = 'segments' }) => {
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
  if (!json) {
    throw new Error('OpenAI response missing JSON body')
  }

  if (responseKey === 'segments') {
    if (!Array.isArray(json.segments)) {
      throw new Error('OpenAI response missing segments array')
    }
    return json.segments
  }

  if (responseKey === 'indices') {
    if (!Array.isArray(json.indices)) {
      throw new Error('OpenAI response missing indices array')
    }
    return json.indices
  }

  return json
}

const normalizeSeverity = (value) => {
  if (!value) return 'none'
  const lower = value.toString().toLowerCase()
  if (lower === 'major' || lower === 'minor') return lower
  return 'none'
}

const normalizeConfidence = (value, fallback = 0.5) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  if (parsed > 1) return 1
  return parsed
}

const assessSegments = async ({ apiKey, endpoint, model, temperature, segments, projectTitle, language, signal }) => {
  const assessments = new Map()
  const batches = chunkArray(segments, DEFAULT_DIAG_BATCH_SIZE)
  const globalHeuristics = new Map(segments.map((segment) => [segment.index, heuristicIssues(segment)]))

  for (const batch of batches) {
    const heuristicHints = batch.map((segment) => ({
      index: segment.index,
      hints: globalHeuristics.get(segment.index) || [],
    }))

    try {
      const messages = buildDiagnosisMessages({
        projectTitle,
        language,
        focusSegments: batch,
        heuristics: heuristicHints,
      })
      const response = await callOpenAI({ apiKey, endpoint, model, messages, temperature, abortSignal: signal, responseKey: 'segments' })

      for (const item of response) {
        if (!item || typeof item.index !== 'number') continue
        const severity = normalizeSeverity(item.severity)
        const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
        const confidence = normalizeConfidence(item.confidence, severity === 'major' ? 0.85 : 0.65)
        const manualHints = heuristicHints.find((entry) => entry.index === item.index)?.hints || []
        const mergedReason = manualHints.length ? `${reason ? `${reason}; ` : ''}${manualHints.join('; ')}` : reason
        assessments.set(item.index, { severity, reason: mergedReason, confidence })
      }
    } catch (error) {
      console.error('[ai/rewrite] assessment batch failed', error)
    }
  }

  segments.forEach((segment) => {
    const existing = assessments.get(segment.index)
    const hints = globalHeuristics.get(segment.index) || []

    if (!existing) {
      const severity = hints.length ? 'minor' : 'none'
      assessments.set(segment.index, {
        severity,
        reason: hints.join('; '),
        confidence: hints.length ? 0.65 : 0.5,
      })
      return
    }

    if (existing.severity === 'none' && hints.length) {
      assessments.set(segment.index, {
        severity: 'minor',
        reason: existing.reason ? `${existing.reason}; ${hints.join('; ')}` : hints.join('; '),
        confidence: Math.max(existing.confidence ?? 0.5, 0.65),
      })
    }
  })

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
  targets,
  signal,
}) => {
  if (!targets.length) return []
  const messages = buildRewriteMessages({ projectTitle, language, segments, targets })
  return callOpenAI({ apiKey, endpoint, model, messages, temperature, abortSignal: signal })
}

const prioritizeSegments = async ({
  apiKey,
  endpoint,
  model,
  temperature,
  projectTitle,
  language,
  assessments,
  maxCount,
  signal,
}) => {
  const summary = Array.from(assessments.entries()).map(([index, value]) => ({ index, ...value }))
  const messages = buildPrioritizationMessages({ projectTitle, language, segmentsSummary: summary, maxCount })
  try {
    const indices = await callOpenAI({ apiKey, endpoint, model, messages, temperature, abortSignal: signal, responseKey: 'indices' })
    const filtered = Array.isArray(indices) ? indices.filter((value) => Number.isFinite(value)) : []
    return filtered
      .map((index) => summary.find((item) => item.index === index))
      .filter(Boolean)
      .slice(0, maxCount)
  } catch (error) {
    console.error('[ai/rewrite] prioritisation request failed', error)
    return summary
      .filter(({ severity }) => severity !== 'none')
      .sort((a, b) => {
        const severityScore = (value) => (value === 'major' ? 2 : value === 'minor' ? 1 : 0)
        const diff = severityScore(b.severity) - severityScore(a.severity)
        if (diff !== 0) return diff
        return (b.confidence ?? 0) - (a.confidence ?? 0)
      })
      .slice(0, maxCount)
  }
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
  const minSelect = clampPositiveInt(DEFAULT_MIN_SELECT, 10)

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

  if (process.env.NODE_ENV === 'development') {
    try {
      console.log('[ai/rewrite] assessed segments', {
        totalSegments: workingSegments.length,
        assessedCount: assessments.size,
      })
    } catch (_) {
      // ignore logging issues in edge runtimes
    }
  }

  let targets = await prioritizeSegments({
    apiKey,
    endpoint,
    model,
    temperature,
    projectTitle,
    language,
    assessments,
    maxCount: selectLimit,
    signal,
  })

  const severityScore = (value) => {
    if (value === 'major') return 2
    if (value === 'minor') return 1
    return 0
  }

  if (!targets.length) {
    targets = []
  }

  const desiredCount = Math.min(selectLimit, Math.max(minSelect, targets.length || 0))

  if (targets.length < desiredCount) {
    const existing = new Set(targets.map(({ index }) => index))
    const fallback = Array.from(assessments.entries())
      .map(([index, value]) => ({ index, ...value }))
      .filter(({ index, severity }) => severity !== 'none' && !existing.has(index))
      .sort((a, b) => {
        const diff = severityScore(b.severity) - severityScore(a.severity)
        if (diff !== 0) return diff
        return (b.confidence ?? 0) - (a.confidence ?? 0)
      })
      .slice(0, desiredCount - targets.length)

    targets = targets.concat(fallback)

    if (process.env.NODE_ENV === 'development') {
      try {
        console.log('[ai/rewrite] prioritisation fallback used', { desiredCount, fallbackCount: fallback.length })
      } catch (_) {}
    }
  }

  if (targets.length < desiredCount) {
    const existing = new Set(targets.map(({ index }) => index))
    const candidates = workingSegments
      .filter((segment) => !existing.has(segment.index))
      .map((segment) => ({
        index: segment.index,
        severity: 'minor',
        reason: 'No specific issue detected; improve clarity and fluency.',
        confidence: 0.55,
      }))

    const generic = []
    const needed = desiredCount - targets.length
    if (candidates.length) {
      const step = Math.max(1, Math.floor(candidates.length / needed) || 1)
      for (let cursor = 0; cursor < candidates.length && generic.length < needed; cursor += step) {
        generic.push(candidates[cursor])
      }
      // If spacing skipped remainder, fill sequentially
      let tail = 0
      while (generic.length < needed && tail < candidates.length) {
        const candidate = candidates[tail++]
        if (!generic.some(({ index }) => index === candidate.index)) {
          generic.push(candidate)
        }
      }
    }

    targets = targets.concat(generic)

    if (process.env.NODE_ENV === 'development') {
      try {
        console.log('[ai/rewrite] extended with generic targets', { added: generic.length })
      } catch (_) {}
    }
  }

  if (!targets.length) {
    return new Map()
  }

  if (process.env.NODE_ENV === 'development') {
    try {
      console.log('[ai/rewrite] prioritised targets', targets)
    } catch (_) {
      // ignore logging issues in non-node runtimes
    }
  }

  const targetIndices = targets.map((item) => item.index)

  let rewriteResponses = []
  try {
    rewriteResponses = await rewriteSelectedSegments({
      apiKey,
      endpoint,
      model,
      temperature,
      projectTitle,
      language,
      segments: workingSegments,
      targets,
      signal,
    })
  } catch (error) {
    console.error('[ai/rewrite] rewrite request failed', error)
    return new Map()
  }

  const rewrites = new Map()
  const targetMap = new Map(targets.map((item) => [item.index, item]))

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

    const changedChars = countChangedCharacters(diff)
    const notesFromModel = typeof item.notes === 'string' ? item.notes.trim() : ''
    const assessment = assessments.get(item.index)
    const targetMeta = targetMap.get(item.index)
    const severity = targetMeta?.severity || assessment?.severity || classifySeverity({ diff, original: segment.originalText, rewrite })
    const reason = notesFromModel || targetMeta?.reason || assessment?.reason || ''
    const rankingConfidence = targetMeta?.confidence ?? assessment?.confidence ?? 0.5

    rewrites.set(item.index, {
      rewrite,
      confidence,
      notes: reason || null,
      severity,
      changedChars,
      severityConfidence: rankingConfidence,
    })
  }

  if (!rewrites.size) {
    return rewrites
  }

  const ranked = Array.from(rewrites.entries())
    .map(([index, payload]) => ({ index, ...payload }))
    .sort((a, b) => {
      const diffSeverity = severityScore(b.severity) - severityScore(a.severity)
      if (diffSeverity !== 0) return diffSeverity
      const diffConfidence = (b.severityConfidence ?? 0) - (a.severityConfidence ?? 0)
      if (diffConfidence !== 0) return diffConfidence
      return (b.changedChars || 0) - (a.changedChars || 0)
    })
    .slice(0, selectLimit)

  const limited = new Map()
  ranked.forEach(({ index, changedChars, severityConfidence, ...payload }) => {
    limited.set(index, payload)
  })

  return limited
}

export default generateRewriteSuggestions
