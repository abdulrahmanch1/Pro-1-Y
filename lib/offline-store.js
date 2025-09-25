import { randomUUID } from 'crypto'

const getStore = () => {
  if (!globalThis.__subtitleOfflineStore) {
    globalThis.__subtitleOfflineStore = new Map()
  }
  return globalThis.__subtitleOfflineStore
}

const ensureUserBucket = (userId) => {
  const store = getStore()
  if (!store.has(userId)) {
    store.set(userId, new Map())
  }
  return store.get(userId)
}

export const createOfflineProject = ({
  userId,
  project,
  segments,
}) => {
  if (!userId) return null

  const projectId = project?.id || randomUUID()
  const userProjects = ensureUserBucket(userId)

  const normalizedSegments = segments.map((segment, position) => ({
    id: segment.id || `offline-${randomUUID()}`,
    index: segment.index ?? position + 1,
    tsStartMs: segment.tsStartMs,
    tsEndMs: segment.tsEndMs,
    originalText: segment.originalText,
    proposedText: segment.proposedText ?? segment.originalText,
    accepted: typeof segment.accepted === 'boolean' ? segment.accepted : true,
    editedText: segment.editedText ?? segment.proposedText ?? segment.originalText,
  }))

  const payload = {
    id: projectId,
    title: project?.title || 'Untitled project',
    status: project?.status || 'review',
    sourceFileName: project?.sourceFileName || null,
    sourceFilePath: project?.sourceFilePath || null,
    createdAt: project?.createdAt || new Date().toISOString(),
    segments: normalizedSegments,
    offline: true,
  }

  userProjects.set(projectId, payload)
  return payload
}

export const getOfflineProject = ({ userId, projectId }) => {
  if (!userId || !projectId) return null
  const userProjects = getStore().get(userId)
  return userProjects?.get(projectId) ?? null
}

export const deleteOfflineProject = ({ userId, projectId }) => {
  if (!userId || !projectId) return
  const userProjects = getStore().get(userId)
  userProjects?.delete(projectId)
}

export const listOfflineProjects = ({ userId }) => {
  if (!userId) return []
  const userProjects = getStore().get(userId)
  if (!userProjects) return []
  return Array.from(userProjects.values())
}

export const updateOfflineSegments = ({ userId, projectId, updates }) => {
  const project = getOfflineProject({ userId, projectId })
  if (!project) return null

  const segmentsMap = new Map(project.segments.map((segment) => [segment.id, { ...segment }]))
  const applied = []

  updates.forEach((update) => {
    const segment = segmentsMap.get(update.id)
    if (!segment) return

    if (typeof update.accepted === 'boolean') {
      segment.accepted = update.accepted
    }
    if (typeof update.editedText === 'string') {
      segment.editedText = update.editedText
    }
    if (typeof update.proposedText === 'string') {
      segment.proposedText = update.proposedText
      // Keep edited text in sync when proposed text changes but edited text not supplied
      if (update.editedText === undefined && segment.editedText === segment.originalText) {
        segment.editedText = update.proposedText
      }
    }

    segmentsMap.set(segment.id, segment)
    applied.push({ ...segment })
  })

  project.segments = project.segments.map((segment) => segmentsMap.get(segment.id) || segment)

  return applied
}
