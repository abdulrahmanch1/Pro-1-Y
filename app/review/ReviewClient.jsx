'use client'

import { useCallback, useMemo, useState } from 'react'

const formatTime = (ms) => {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const milliseconds = ms % 1000
  const pad = (value, size) => value.toString().padStart(size, '0')
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`
}

const buildRange = (segment) => `${formatTime(segment.tsStartMs)} --> ${formatTime(segment.tsEndMs)}`

export default function ReviewClient({ project }) {
  const [segments, setSegments] = useState(project.segments)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  const projectTitle = project.title || project.sourceFileName || 'Untitled project'

  const persistUpdates = useCallback(async (updates) => {
    if (!updates.length) return
    setSaving(true)
    setError(null)

    const response = await fetch(`/api/projects/${project.id}/segments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })

    setSaving(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setError(payload.error || 'Failed to save changes.')
      return
    }

    const payload = await response.json()
    if (Array.isArray(payload.segments)) {
      setSegments((prev) => prev.map((segment) => {
        const next = payload.segments.find((item) => item.id === segment.id)
        return next ? { ...segment, ...next } : segment
      }))
    }
  }, [project.id])

  const setAccept = useCallback((segmentId, accepted) => {
    setSegments((prev) => prev.map((segment) => segment.id === segmentId ? { ...segment, accepted } : segment))
    persistUpdates([{ id: segmentId, accepted }])
  }, [persistUpdates])

  const setEditedText = useCallback((segmentId, editedText) => {
    setSegments((prev) => prev.map((segment) => segment.id === segmentId ? { ...segment, editedText } : segment))
  }, [])

  const commitEditedText = useCallback((segmentId, editedText) => {
    persistUpdates([{ id: segmentId, editedText }])
  }, [persistUpdates])

  const acceptAll = useCallback((value) => {
    setSegments((prev) => {
      const updates = prev.map((segment) => ({ id: segment.id, accepted: value }))
      persistUpdates(updates)
      return prev.map((segment) => ({ ...segment, accepted: value }))
    })
  }, [persistUpdates])

  const download = async () => {
    setExporting(true)
    setError(null)
    const response = await fetch(`/api/projects/${project.id}/export`, {
      method: 'POST',
    })
    setExporting(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setError(payload.error || 'Export failed. Try again.')
      return
    }

    const payload = await response.json()
    if (payload.downloadUrl) {
      window.location.href = payload.downloadUrl
    }
  }

  const acceptedCount = useMemo(() => segments.filter((segment) => segment.accepted).length, [segments])

  return (
    <section className="section">
      <div className="section-header">
        <span className="eyebrow">Review</span>
        <h2>{projectTitle}</h2>
        <p>Swipe through improvements, toggle what to keep, and edit inline. Changes auto-save to Supabase.</p>
      </div>

      <div className="review-toolbar mt-4">
        <div className="review-stepper">
          <span>Upload</span>
          <span aria-hidden>›</span>
          <span>Review</span>
          <span aria-hidden>›</span>
          <span>Download</span>
        </div>
        <div className="flex" style={{alignItems:'center', gap: '0.8rem'}}>
          <span className="tag">{acceptedCount}/{segments.length} accepted</span>
          <button className="btn btn-outline" type="button" onClick={() => acceptAll(true)}>Accept all</button>
          <button className="btn btn-ghost" type="button" onClick={() => acceptAll(false)}>Reject all</button>
          <button className="btn btn-primary" type="button" onClick={download} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Download captions'}
          </button>
        </div>
      </div>

      {saving ? (
        <div className="alert alert-info" style={{marginTop:'1rem'}}>
          <span>Saving changes…</span>
        </div>
      ) : null}
      {error ? (
        <div className="alert alert-error" style={{marginTop:'1rem'}}>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="review-list">
        {segments.map((segment) => (
          <article key={segment.id} className="review-row">
            <div className="stack">
              <div className="flex" style={{alignItems:'center'}}>
                <span className={`badge ${segment.accepted ? 'badge--ok' : 'badge--warn'}`}>
                  {segment.accepted ? 'Proposed' : 'Original'}
                </span>
                <code style={{color:'var(--text-subtle)'}}>{buildRange(segment)}</code>
              </div>
              <pre className="review-line original">{segment.originalText}</pre>
              <pre
                className="review-line"
                contentEditable
                suppressContentEditableWarning
                onInput={(event) => setEditedText(segment.id, event.currentTarget.textContent || '')}
                onBlur={(event) => commitEditedText(segment.id, event.currentTarget.textContent || '')}
              >{segment.editedText || segment.proposedText || segment.originalText}</pre>
            </div>
            <div className="flex" style={{alignItems:'center'}}>
              <div
                role="switch"
                aria-checked={segment.accepted}
                className="review-toggle"
                data-on={segment.accepted ? 'true' : 'false'}
                onClick={() => setAccept(segment.id, !segment.accepted)}
                title={segment.accepted ? 'Keep proposed change' : 'Revert to original'}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
