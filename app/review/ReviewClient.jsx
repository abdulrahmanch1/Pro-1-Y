'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useDebounce } from '@/hooks/useDebounce'
import { diffWords } from '@/lib/diff/words'

const formatTime = (ms) => {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const milliseconds = ms % 1000
  const pad = (value, size) => value.toString().padStart(size, '0')
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`
}

const buildRange = (segment) => `${formatTime(segment.tsStartMs)} --> ${formatTime(segment.tsEndMs)}`

const normalizeText = (value) => (value ?? '').replace(/\s+/g, ' ').trim()

const segmentHasChanges = (segment) => {
  const original = normalizeText(segment.originalText)
  const proposed = normalizeText(segment.proposedText)
  const edited = normalizeText(segment.editedText)

  return (
    (segment.proposedText != null && proposed !== original) ||
    (segment.editedText != null && edited !== original)
  )
}

const ProcessingState = () => {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.refresh();
    }, 3000); // Poll every 3 seconds

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="card" style={{marginTop:'2rem', textAlign: 'center'}}>
      <span className="tag">Processing</span>
      <h3 className="mt-3">Preparing your captions...</h3>
      <p>Your file is being processed on the server. This page will automatically update when it&apos;s ready for review.</p>
      <p className="upload-hint mt-3">You can safely leave this page and come back later.</p>
    </div>
  );
};

const ErrorState = () => (
  <div className="alert alert-error" style={{marginTop:'2rem'}}>
    <span>There was an error processing your file. Please try uploading it again.</span>
  </div>
);

const DiffPreview = ({ tokens }) => {
  if (!tokens.length) return null
  const hasChanges = tokens.some((token) => token.type !== 'equal')
  if (!hasChanges) return null

  const renderTokens = tokens.map((token, index) => {
    if (token.type === 'delete') return null
    const className = token.type === 'delete'
      ? 'diff-chunk diff-chunk--removed'
      : token.type === 'insert'
        ? 'diff-chunk diff-chunk--added'
        : 'diff-chunk'
    return <span key={index} className={className}>{token.value}</span>
  })

  return (
    <div className="diff-preview">
      <span className="diff-preview__label">Edited preview</span>
      <pre className="review-line diff-preview__line">
        {renderTokens}
      </pre>
    </div>
  )
}

const ReviewSegmentRow = ({ segment, onToggleAccept, onTextEdit }) => {
  const currentText = segment.editedText || segment.proposedText || segment.originalText
  const tokens = useMemo(() => diffWords(segment.originalText || '', currentText || ''), [segment.originalText, currentText])
  const aiSuggested = (segment.proposedText || '').trim() && (segment.proposedText || '').trim() !== (segment.originalText || '').trim()

  return (
    <article className="review-row">
      <div className="stack">
        <div className="flex review-segment-meta">
          <span className={`badge ${aiSuggested ? 'badge--info' : segment.accepted ? 'badge--ok' : 'badge--warn'}`}>
            {aiSuggested ? 'AI rewrite' : segment.accepted ? 'Proposed' : 'Original'}
          </span>
          <code style={{color:'var(--text-subtle)'}}>{buildRange(segment)}</code>
        </div>
        <pre className="review-line original">
          {tokens.length
            ? tokens.map((token, index) => {
                if (token.type === 'insert') return null
                const className = token.type === 'delete' ? 'diff-chunk diff-chunk--removed' : 'diff-chunk'
                return <span key={index} className={className}>{token.value}</span>
              })
            : segment.originalText}
        </pre>
        <div
          className="review-line review-line--editable"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          spellCheck="true"
          onInput={(event) => onTextEdit(segment.id, event.currentTarget.textContent || '')}
        >{currentText}</div>
        <DiffPreview tokens={tokens} />
      </div>
      <div className="flex" style={{alignItems:'center'}}>
        <div
          role="switch"
          aria-checked={segment.accepted}
          className="review-toggle"
          data-on={segment.accepted ? 'true' : 'false'}
          onClick={() => onToggleAccept(segment.id, !segment.accepted)}
          title={segment.accepted ? 'Keep proposed change' : 'Revert to original'}
        />
      </div>
    </article>
  )
}

export default function ReviewClient({ project }) {
  const [segments, setSegments] = useState(() => project.segments || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [showOnlyChanged, setShowOnlyChanged] = useState(() => (project.segments || []).some(segmentHasChanges))
  const [userToggledFilter, setUserToggledFilter] = useState(false)
  const [status, setStatus] = useState(project.status)
  const lastProjectIdRef = useRef(project.id)
  const segmentsRef = useRef(project.segments || [])

  // State for debouncing text edits
  const [editText, setEditText] = useState(null)
  const debouncedEditText = useDebounce(editText, 750)

  const projectTitle = project.title || project.sourceFileName || 'Untitled project'

  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  useEffect(() => {
    if (lastProjectIdRef.current !== project.id) {
      lastProjectIdRef.current = project.id
      const nextSegments = project.segments || []
      segmentsRef.current = nextSegments
      setSegments(nextSegments)
      setStatus(project.status)
      setUserToggledFilter(false)
      setShowOnlyChanged((project.segments || []).some(segmentHasChanges))
      return
    }

    const incoming = project.segments || []
    if (!incoming.length) {
      setStatus(project.status)
      return
    }

    setSegments((prev) => (prev.length ? prev : incoming))
    setStatus(project.status)

    if (!userToggledFilter && incoming.some(segmentHasChanges)) {
      setShowOnlyChanged(true)
    }
  }, [project.id, project.segments, project.status, userToggledFilter])

  useEffect(() => {
    if (!project.id || project.offline) return
    if (segments.length) return

    let cancelled = false
    let timeoutId

    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${project.id}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Failed to load project')
        const payload = await response.json()
        if (cancelled) return

        if (Array.isArray(payload.segments) && payload.segments.length) {
          setSegments(payload.segments)
          setStatus(payload.status || 'review')
          if (!userToggledFilter) {
            const hasChanges = payload.segments.some(segmentHasChanges)
            setShowOnlyChanged(hasChanges)
          }
          return
        }

        if (payload.status && payload.status !== status) {
          setStatus(payload.status)
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[review] polling failed', err?.message)
        }
      }

      if (!cancelled) {
        timeoutId = setTimeout(poll, 3000)
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [project.id, project.offline, segments.length, status, userToggledFilter])

  const persistUpdates = useCallback(async (updates, { onError } = {}) => {
    if (!updates.length) return
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${project.id}/segments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to save changes.')
      }

      const payload = await response.json()
      if (Array.isArray(payload.segments)) {
        setSegments((prev) => prev.map((segment) => {
          const next = payload.segments.find((item) => item.id === segment.id)
          return next ? { ...segment, ...next } : segment
        }))
      }
    } catch (err) {
      setError(err.message || 'Failed to save changes.')
      if (typeof onError === 'function') {
        onError()
      }
    } finally {
      setSaving(false)
    }
  }, [project.id])

  // Effect to save debounced text changes
  useEffect(() => {
    if (!debouncedEditText) return

    const { id, text, previousText } = debouncedEditText
    if (text === previousText) return

    persistUpdates([{ id, editedText: text }], {
      onError: () => {
        setSegments((prev) => prev.map((segment) => (
          segment.id === id ? { ...segment, editedText: previousText } : segment
        )))
      },
    })

    setEditText(null)
  }, [debouncedEditText, persistUpdates])

  const setAccept = useCallback((segmentId, accepted) => {
    const originalSegment = segmentsRef.current.find((segment) => segment.id === segmentId)
    setSegments((prev) => prev.map((segment) => segment.id === segmentId ? { ...segment, accepted } : segment))
    persistUpdates([{ id: segmentId, accepted }], {
      onError: () => {
        if (!originalSegment) return
        setSegments((prev) => prev.map((segment) => (
          segment.id === segmentId ? { ...segment, accepted: originalSegment.accepted } : segment
        )))
      },
    })
  }, [persistUpdates])

  const handleTextEdit = useCallback((segmentId, newText) => {
    const originalSegment = segmentsRef.current.find((segment) => segment.id === segmentId)

    // Update the UI state immediately for responsiveness
    setSegments((prev) => prev.map((segment) => (
      segment.id === segmentId ? { ...segment, editedText: newText } : segment
    )))

    // Set the value to be debounced and saved, including a rollback snapshot
    setEditText({ id: segmentId, text: newText, previousText: originalSegment?.editedText })
  }, [])

  const acceptAll = useCallback((value) => {
    const currentSegments = segmentsRef.current || []
    const targetSegments = showOnlyChanged
      ? currentSegments.filter(segmentHasChanges)
      : currentSegments

    if (!targetSegments.length) return

    const updates = targetSegments.map(({ id }) => ({ id, accepted: value }))
    const targetIds = new Set(targetSegments.map(({ id }) => id))
    const rollbackMap = new Map(targetSegments.map(({ id, accepted: previousAccepted }) => [id, previousAccepted]))

    setSegments((prev) => prev.map((segment) => (
      targetIds.has(segment.id) ? { ...segment, accepted: value } : segment
    )))

    persistUpdates(updates, {
      onError: () => {
        setSegments((prev) => prev.map((segment) => (
          rollbackMap.has(segment.id)
            ? { ...segment, accepted: rollbackMap.get(segment.id) }
            : segment
        )))
      },
    })
  }, [persistUpdates, showOnlyChanged])

  const download = useCallback(async () => {
    setExporting(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${project.id}/export`, {
        method: 'POST',
      })

      if (!response.ok) {
        let message = 'Export failed. Try again.'
        try {
          const payload = await response.json()
          message = payload.error || message
        } catch (_) {
          const fallback = await response.text().catch(() => '')
          message = fallback || message
        }
        throw new Error(message)
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const payload = await response.json()

        if (payload.downloadUrl) {
          window.location.href = payload.downloadUrl
          return
        }

        if (payload.fileName && typeof payload.content === 'string') {
          const blob = new Blob([payload.content], { type: 'text/plain;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = payload.fileName
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
          return
        }

        throw new Error(payload.error || 'Export failed. Try again.')
      }

      const text = await response.text()
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const filename = `${project.title || project.sourceFileName || 'captions'}.srt`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || 'Export failed. Try again.')
    } finally {
      setExporting(false)
    }
  }, [project.id, project.sourceFileName, project.title])

  const changedSegments = useMemo(() => segments.filter(segmentHasChanges), [segments])
  const visibleSegments = useMemo(
    () => (showOnlyChanged ? changedSegments : segments),
    [changedSegments, segments, showOnlyChanged],
  )
  const aiFixCount = useMemo(() => changedSegments.length, [changedSegments])

  const acceptedCount = useMemo(() => visibleSegments.filter((segment) => segment.accepted).length, [visibleSegments])

  const hasSegments = segments.length > 0
  const isProcessing = status === 'processing' && !hasSegments;
  const isError = status === 'error';

  return (
    <section className="section">
      <div className="section-header">
        <span className="eyebrow">Review</span>
        <h2>{projectTitle}</h2>
        <p>Swipe through improvements, toggle what to keep, and edit inline. Changes auto-save to Supabase.</p>
      </div>

      {isProcessing ? <ProcessingState /> : isError ? <ErrorState /> : (
        <>
          <div className="review-toolbar mt-4">
            <div className="review-stepper">
              <span>Upload</span>
              <span aria-hidden>›</span>
              <span>Review</span>
              <span aria-hidden>›</span>
              <span>Download</span>
            </div>
            <div className="flex review-actions" style={{alignItems:'center', gap: '0.8rem'}}>
              <span className="tag">{acceptedCount}/{visibleSegments.length || 0} accepted</span>
              <span className="tag tag--info">AI fixes: {aiFixCount}</span>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setUserToggledFilter(true)
                  setShowOnlyChanged((prev) => !prev)
                }}
              >
                {showOnlyChanged ? 'Show all segments' : 'Show edited segments only'}
              </button>
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
            {visibleSegments.length ? (
              visibleSegments.map((segment) => (
                <ReviewSegmentRow
                  key={segment.id}
                  segment={segment}
                  onToggleAccept={setAccept}
                  onTextEdit={handleTextEdit}
                />
              ))
            ) : (
              <div className="card" style={{marginTop:'2rem'}}>
                <h3>No edits to review.</h3>
                {showOnlyChanged ? (
                  <p>All segments match the original transcript. Switch to showing all segments if you need to inspect everything.</p>
                ) : (
                  <p>Your transcript is empty.</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
