import { beforeEach, describe, expect, it } from 'vitest'

import {
  createOfflineProject,
  getOfflineProject,
  listOfflineProjects,
  updateOfflineSegments,
} from '@/lib/offline-store'

describe('offline store', () => {
  const userId = 'offline-user'

  beforeEach(() => {
    delete globalThis.__subtitleOfflineStore
  })

  const buildProject = () => createOfflineProject({
    userId,
    project: {
      id: 'project-1',
      title: 'Test project',
      status: 'review',
      sourceFileName: 'example.srt',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    segments: [
      {
        id: 'seg-1',
        index: 1,
        tsStartMs: 1000,
        tsEndMs: 2000,
        originalText: 'Hello world',
        proposedText: 'Hello world!',
      },
      {
        id: 'seg-2',
        index: 2,
        tsStartMs: 2500,
        tsEndMs: 3200,
        originalText: 'Second line',
      },
    ],
  })

  it('creates, retrieves, and lists offline projects for a user', () => {
    const project = buildProject()

    expect(project.id).toBe('project-1')
    expect(project.segments).toHaveLength(2)
    expect(project.segments[0]).toMatchObject({
      id: 'seg-1',
      proposedText: 'Hello world!',
      accepted: true,
      editedText: 'Hello world!',
    })

    const fetched = getOfflineProject({ userId, projectId: 'project-1' })
    expect(fetched?.title).toBe('Test project')

    const projects = listOfflineProjects({ userId })
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('project-1')
  })

  it('updates segment acceptance and edited text in place', () => {
    const project = buildProject()
    expect(project.segments[1].proposedText).toBe('Second line')

    const updated = updateOfflineSegments({
      userId,
      projectId: 'project-1',
      updates: [
        { id: 'seg-1', accepted: false, editedText: 'Keep original' },
        { id: 'seg-2', proposedText: 'Tweaked line' },
      ],
    })

    expect(updated).toHaveLength(2)
    const first = updated.find((segment) => segment.id === 'seg-1')
    expect(first).toMatchObject({
      accepted: false,
      editedText: 'Keep original',
    })

    const reloaded = getOfflineProject({ userId, projectId: 'project-1' })
    expect(reloaded.segments[0].accepted).toBe(false)
    expect(reloaded.segments[0].editedText).toBe('Keep original')
    expect(reloaded.segments[1].proposedText).toBe('Tweaked line')
    expect(reloaded.segments[1].editedText).toBe('Tweaked line')
  })
})
