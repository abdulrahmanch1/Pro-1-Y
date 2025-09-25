'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UploadClient() {
  const router = useRouter()
  const fileInputRef = useRef(null)
  const [projectName, setProjectName] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleFiles = (event) => {
    const selected = event.target.files?.[0]
    if (selected) {
      setFile(selected)
      setError(null)
    }
  }

  const openPicker = () => {
    fileInputRef.current?.click()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!file) {
      setError('Choose an SRT or VTT file to continue.')
      return
    }

    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    if (projectName) formData.append('title', projectName)

    // 1. Create the project and upload the file.
    const response = await fetch('/api/projects', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setError(payload.error || 'Upload failed. Try again.')
      setLoading(false)
      return
    }

    const payload = await response.json()
    const projectId = payload?.projectId
    const processed = payload?.processed === true

    if (!projectId) {
      setError('Upload failed. Try again.')
      setLoading(false)
      return
    }

    // 2. Trigger the background processing job only when required.
    if (!processed) {
      fetch(`/api/projects/${projectId}/process`, { method: 'POST' })
        .catch(err => console.error('Failed to trigger processing job:', err))
    }

    // 3. Redirect the user immediately to the review page.
    router.push(`/review?projectId=${projectId}`)
  }

  return (
    <section className="section">
      <div className="section-header">
        <span className="eyebrow">Upload</span>
        <h2>Drop in your captions. We’ll prep them for review.</h2>
        <p>Subtitle AI supports SRT, VTT, and multi-track uploads. Everything stays private — you control what gets exported.</p>
      </div>

      <form className="grid grid-2" style={{marginTop:'2rem', alignItems:'stretch'}} onSubmit={handleSubmit}>
        <div className="panel upload-shell">
          <div className="upload-drop">
            <h3>Drag & drop</h3>
            <p className="mt-2">SRT, VTT, or WebVTT. Max 50MB per file.</p>
            <div className="stack">
              <label className="label" htmlFor="project-name">Project name (optional)</label>
              <input
                id="project-name"
                className="input"
                type="text"
                placeholder="Episode 05 — Launch trailer"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
            </div>
            <button type="button" className="btn btn-primary mt-3" style={{display:'inline-flex'}} onClick={openPicker}>
              Choose file
            </button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept=".srt,.vtt,.webvtt"
              onChange={handleFiles}
            />
            {file ? <p className="upload-hint mt-3">Selected: {file.name}</p> : <p className="upload-hint mt-3">No files leave your browser until you confirm the export.</p>}
          </div>
          <div className="flex" style={{justifyContent:'space-between', alignItems:'center'}}>
            <div className="pill-row">
              <span className="tag">UTF-8 ensured</span>
              <span className="tag">Timestamp safe</span>
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Processing…' : 'Continue'}
            </button>
          </div>
          {error ? (
            <div className="alert alert-error mt-3">
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="card">
          <span className="tag">Before you start</span>
          <div className="stack">
            <div>
              <h3>Best practices</h3>
              <p className="mt-2">Group related files together so the assistant understands scene context. Multi-language tracks will soon be supported.</p>
            </div>
            <div>
              <h3>What we check</h3>
              <p className="mt-2">Grammar, fluency, weird word choices, tone shifts, and timing offsets vs. the speaker cadence.</p>
            </div>
            <div>
              <h3>Exports</h3>
              <p className="mt-2">One credit per download. Your wallet ledger stays in sync automatically.</p>
            </div>
          </div>
        </div>
      </form>
    </section>
  )
}
