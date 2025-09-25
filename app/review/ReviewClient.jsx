'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
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
      <p>Your file is being processed on the server. This page will automatically update when it's ready for review.</p>
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

  return (
    <article className="review-row">
      <div className="stack">
        <div className="flex" style={{alignItems:'center'}}>
          <span className={`badge ${segment.accepted ? 'badge--ok' : 'badge--warn'}`}>
            {segment.accepted ? 'Proposed' : 'Original'}
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
        <pre
          className="review-line"
          contentEditable
          suppressContentEditableWarning
          onInput={(event) => onTextEdit(segment.id, event.currentTarget.textContent || '')}
        >{currentText}</pre>
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
  const [segments, setSegments] = useState(project.segments)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  // State for debouncing text edits
  const [editText, setEditText] = useState(null)
  const debouncedEditText = useDebounce(editText, 750)

  const projectTitle = project.title || project.sourceFileName || 'Untitled project'

  const persistUpdates = useCallback(async (updates) => {
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
    } finally {
      setSaving(false)
    }
  }, [project.id])

  // Effect to save debounced text changes
  useEffect(() => {
    if (debouncedEditText) {
      persistUpdates([{ id: debouncedEditText.id, editedText: debouncedEditText.text }])
    }
  }, [debouncedEditText, persistUpdates])

  const setAccept = useCallback((segmentId, accepted) => {
    setSegments((prev) => prev.map((segment) => segment.id === segmentId ? { ...segment, accepted } : segment))
    persistUpdates([{ id: segmentId, accepted }])
  }, [persistUpdates])

  const handleTextEdit = useCallback((segmentId, newText) => {
    // Update the UI state immediately for responsiveness
    setSegments((prev) => prev.map((segment) => segment.id === segmentId ? { ...segment, editedText: newText } : segment))
    // Set the value to be debounced and saved
    setEditText({ id: segmentId, text: newText })
  }, [])

  const acceptAll = useCallback((value) => {
    setSegments((prev) => {
      const updates = prev.map((segment) => ({ id: segment.id, accepted: value }))
      persistUpdates(updates)
      return prev.map((segment) => ({ ...segment, accepted: value }))
    })
  }, [persistUpdates])

  const download = useCallback(async () => {
    setExporting(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${project.id}/export`, {
        method: 'POST',
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Export failed. Try again.')
      }

      const payload = await response.json()
      if (payload.downloadUrl) {
        window.location.href = payload.downloadUrl
      }
    } catch (err) {
      setError(err.message || 'Export failed. Try again.')
    } finally {
      setExporting(false)
    }
  }, [project.id])

  const acceptedCount = useMemo(() => segments.filter((segment) => segment.accepted).length, [segments])

  const isProcessing = project.status === 'processing';
  const isError = project.status === 'error';

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
              <ReviewSegmentRow
                key={segment.id}
                segment={segment}
                onToggleAccept={setAccept}
                onTextEdit={handleTextEdit}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
