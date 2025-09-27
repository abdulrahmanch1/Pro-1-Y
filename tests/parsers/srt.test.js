import { describe, expect, it } from 'vitest'

import { parseSrt, serializeSegmentsToSrt } from '@/lib/parsers/srt'

const sampleSrt = `1\n00:00:01,000 --> 00:00:02,000\nHello world!\n\n2\n00:00:03,500 --> 00:00:05,000\nNew line here.`

describe('parseSrt', () => {
  it('parses basic SRT content with indices and timings', () => {
    const segments = parseSrt(sampleSrt)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      index: 1,
      tsStartMs: 1000,
      tsEndMs: 2000,
      originalText: 'Hello world!',
    })
    expect(segments[1]).toMatchObject({
      index: 2,
      tsStartMs: 3500,
      tsEndMs: 5000,
      originalText: 'New line here.',
    })
  })

  it('normalises WebVTT headers and UTF-8 BOM', () => {
    const content = `\uFEFFWEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst line\n\n00:00:03.000 --> 00:00:04.000\nSecond line`
    const segments = parseSrt(content)
    expect(segments).toHaveLength(2)
    expect(segments[0].index).toBe(1)
    expect(segments[0].tsStartMs).toBe(1000)
    expect(segments[0].originalText).toBe('First line')
  })

  it('throws for malformed files without timing lines', () => {
    const malformed = '1\nNo timing here\nJust text'
    expect(() => parseSrt(malformed)).toThrowError()
  })
})

describe('serializeSegmentsToSrt', () => {
  it('serializes segments back to valid SRT', () => {
    const segments = [
      { tsStartMs: 1000, tsEndMs: 2000, text: 'Hello world!' },
      { tsStartMs: 3500, tsEndMs: 5200, text: 'Another line' },
    ]

    const srt = serializeSegmentsToSrt(segments)
    expect(srt.trim()).toBe(`1\n00:00:01,000 --> 00:00:02,000\nHello world!\n\n2\n00:00:03,500 --> 00:00:05,200\nAnother line`)
  })
})
