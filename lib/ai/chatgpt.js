const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const DEFAULT_ENDPOINT = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions'
const DEFAULT_BATCH_SIZE = Number.parseInt(process.env.AI_SEGMENT_BATCH_SIZE || '12', 10)

const formatTime = (ms) => {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const milliseconds = ms % 1000
  const pad = (value, size) => value.toString().padStart(size, '0')
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`
}

const chunkSegments = (segments, size) => {
  if (size <= 0) return [segments]
  const result = []
  for (let i = 0; i < segments.length; i += size) {
    result.push(segments.slice(i, i + size))
  }
  return result
}

const extractJson = (text) => {
  if (!text) return null
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (inner) {
      return null
    }
  }
}

const buildPrompt = ({ projectTitle, language, segments }) => {
  return [
    {
      role: 'system',
      content: `You are an AI caption editor helping creators polish subtitle lines. Improve grammar, clarity, and flow while respecting speaker intent.
- Keep timings untouched.
- Return JSON only following this schema: {"segments": [{"index": number, "suggestion": string, "rationale": string}] }.
- Do not add numbering or timestamps.
- Preserve punctuation that indicates tone (?! …).
- Keep each suggestion under 140 characters where possible.`,
    },
    {
      role: 'user',
      content: `Project: ${projectTitle || 'Untitled project'}
Language: ${language || 'unknown'}
Segments:
${JSON.stringify(
  segments.map((segment) => ({
    index: segment.index,
    start: formatTime(segment.tsStartMs),
    end: formatTime(segment.tsEndMs),
    text: segment.originalText,
  })),
  null,
  2
)}
Respond with JSON only.`,
    },
  ]
}

const callOpenAi = async ({ apiKey, endpoint, model, messages, abortSignal }) => {
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
      temperature: 0.25,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorPayload = await response.text().catch(() => '')
    throw new Error(`OpenAI request failed (${response.status}): ${errorPayload}`)
  }

  const payload = await response.json()
  const text = payload?.choices?.[0]?.message?.content
  const json = extractJson(text)
  if (!json || !Array.isArray(json.segments)) {
    throw new Error('OpenAI response missing expected JSON payload')
  }

  return json.segments
}

export async function generateCaptionSuggestions({ segments, projectTitle, language, signal } = {}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  if (!Array.isArray(segments) || segments.length === 0) {
    return new Map()
  }

  const endpoint = DEFAULT_ENDPOINT
  const model = DEFAULT_MODEL
  const batchSize = Number.isFinite(DEFAULT_BATCH_SIZE) ? DEFAULT_BATCH_SIZE : 12

  const chunks = chunkSegments(segments, batchSize)
  const suggestions = new Map()

  for (const chunk of chunks) {
    const messages = buildPrompt({ projectTitle, language, segments: chunk })
    const result = await callOpenAi({ apiKey, endpoint, model, messages, abortSignal: signal })
    for (const item of result) {
      if (!item || typeof item.index !== 'number') continue
      const suggestion = typeof item.suggestion === 'string' ? item.suggestion.trim() : ''
      const rationale = typeof item.rationale === 'string' ? item.rationale.trim() : ''
      suggestions.set(item.index, {
        suggestion: suggestion || null,
        rationale: rationale || null,
      })
    }
  }

  return suggestions
}
