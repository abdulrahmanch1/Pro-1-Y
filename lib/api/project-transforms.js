export const mapSegmentRow = (segment) => ({
  id: segment.id,
  index: segment.index,
  tsStartMs: segment.ts_start_ms,
  tsEndMs: segment.ts_end_ms,
  originalText: segment.original_text,
  proposedText: segment.proposed_text,
  accepted: segment.accepted,
  editedText: segment.edited_text,
})

export const mapProjectRow = (project) => ({
  id: project.id,
  title: project.title,
  status: project.status,
  sourceFileName: project.source_file_name,
  sourceFilePath: project.source_file_path,
  createdAt: project.created_at,
  segments: Array.isArray(project.segments)
    ? project.segments.map(mapSegmentRow).sort((a, b) => a.index - b.index)
    : [],
})
