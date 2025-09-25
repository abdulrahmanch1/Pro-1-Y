const TIMING_DIVIDER = '-->'

const invariant = (value, message) => {
  if (!value) throw new Error(message)
  return value
}

const pad = (value, length) => value.toString().padStart(length, '0')

const normalizeHeader = (raw = '') => {
  let content = raw.replace(/^\uFEFF/, ''); // remove BOM
  if (content.startsWith('WEBVTT')) {
    // Find the end of the header, which is the first blank line (double newline)
    const match = content.match(/(\r\n|\n){2,}/);
    if (match) {
      // Get content after the header
      return content.substring(match.index + match[0].length);
    }
    // If no blank line, it means no cues, so return empty string
    return '';
  }
  return content; // Not a VTT file, return as is
}

const toMs = (timestamp) => {
  const trimmed = timestamp.trim()
  const [timePart, fractionalPart = '0'] = trimmed.split(/[,.]/)
  const pieces = timePart.split(':').map(Number)

  let hours = 0
  let minutes = 0
  let seconds = 0

  if (pieces.length === 3) {
    [hours, minutes, seconds] = pieces
  } else if (pieces.length === 2) {
    [minutes, seconds] = pieces
  } else {
    throw new Error(`Invalid timestamp: ${timestamp}`)
  }

  if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid timestamp: ${timestamp}`)
  }

  const normalizedFraction = fractionalPart.padEnd(3, '0').slice(0, 3)
  const fractionalMs = Number(normalizedFraction)
  return (((hours * 60 + minutes) * 60) + seconds) * 1000 + fractionalMs
}

const fromMs = (totalMs) => {
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const milliseconds = totalMs % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`
}

const isCommentBlock = (lines = []) => {
  const first = (lines[0] || '').trim().toUpperCase()
  return first.startsWith('NOTE') || first.startsWith('STYLE') || first.startsWith('REGION')
}

export const parseSrt = (raw) => {
  invariant(typeof raw === 'string' && raw.trim().length, 'SRT content must be a non-empty string')

  const cleaned = normalizeHeader(raw)
    .replace(/\r/g, '')
    .trim()

  if (!cleaned) {
    throw new Error('Subtitle file appears to be empty')
  }

  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)

  const segments = []

  blocks.forEach((block, position) => {
    const lines = block.split('\n').filter(Boolean)
    if (!lines.length || isCommentBlock(lines)) return

    const indexCandidate = lines.shift()
    let timingLine = indexCandidate
    const numericIndex = Number(indexCandidate)
    let index = Number.isFinite(numericIndex) ? numericIndex : NaN

    if (Number.isFinite(numericIndex) && lines[0]?.includes(TIMING_DIVIDER)) {
      timingLine = lines.shift()
    } else if (!indexCandidate.includes(TIMING_DIVIDER)) {
      timingLine = invariant(lines.shift(), 'Missing timing line in subtitle block')
    }

    if (!timingLine.includes(TIMING_DIVIDER)) {
      throw new Error('Malformed timing line encountered in subtitle file')
    }

    const [startRaw, endRaw] = timingLine.split(TIMING_DIVIDER).map((s) => s.trim())
    const text = lines.join('\n').trim()

    segments.push({
      index: Number.isFinite(index) && index > 0 ? index : position + 1,
      tsStartMs: toMs(startRaw),
      tsEndMs: toMs(endRaw),
      originalText: text,
    })
  })

  if (!segments.length) {
    throw new Error('No subtitle segments were detected in the file')
  }

  return segments
}

export const serializeSegmentsToSrt = (segments) => {
  invariant(Array.isArray(segments) && segments.length, 'Segments array required to build SRT output')

  return segments
    .map((segment, i) => {
      const start = fromMs(segment.tsStartMs)
      const end = fromMs(segment.tsEndMs)
      const text = segment.text ?? segment.originalText ?? ''
      return `${i + 1}\n${start} ${TIMING_DIVIDER} ${end}\n${text}\n`
    })
    .join('\n')
}
