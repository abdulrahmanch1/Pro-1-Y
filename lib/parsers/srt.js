const TIMING_DIVIDER = '-->'

const invariant = (value, message) => {
  if (!value) throw new Error(message)
  return value
}

const toMs = (timestamp) => {
  const [time, milliseconds] = timestamp.split(',')
  const [hours, minutes, seconds] = time.split(':').map(Number)
  return (((hours * 60 + minutes) * 60) + seconds) * 1000 + Number(milliseconds)
}

const pad = (value, length) => value.toString().padStart(length, '0')

const fromMs = (totalMs) => {
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const milliseconds = totalMs % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`
}

export const parseSrt = (raw) => {
  invariant(typeof raw === 'string' && raw.trim().length, 'SRT content must be a non-empty string')

  const blocks = raw
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/)

  return blocks.map((block) => {
    const lines = block.split('\n').filter(Boolean)
    if (lines.length < 2) throw new Error('Malformed SRT block encountered')

    const index = Number(lines.shift())
    const timingLine = invariant(lines.shift(), 'Missing SRT timing line')
    const [startRaw, endRaw] = timingLine.split(TIMING_DIVIDER).map(s => s.trim())
    const originalText = lines.join('\n').trim()

    return {
      index: Number.isFinite(index) ? index : 0,
      tsStartMs: toMs(startRaw),
      tsEndMs: toMs(endRaw),
      originalText,
    }
  })
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
