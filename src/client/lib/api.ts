import type {
  Comparison,
  FileDiff,
  RepoChanges,
  RepoCommits,
  WorkspaceInfo,
} from '../../shared/types.ts'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok || body.error) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status)
  return body
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** A comparison travels as `mode` plus the refs that mode needs. */
function comparisonParams(comparison: Comparison): URLSearchParams {
  const params = new URLSearchParams({ mode: comparison.mode })
  if (comparison.ref) params.set('ref', comparison.ref)
  if (comparison.base) params.set('base', comparison.base)
  return params
}

const repoUrl = (repo: string, suffix: string): string =>
  `/api/repos/${encodeURIComponent(repo)}/${suffix}`

export const api = {
  workspace: (signal?: AbortSignal) => getJson<WorkspaceInfo>('/api/workspace', signal),

  changes: (repo: string, comparison: Comparison, signal?: AbortSignal) =>
    getJson<RepoChanges>(`${repoUrl(repo, 'changes')}?${comparisonParams(comparison)}`, signal),

  commits: (repo: string, limit: number, signal?: AbortSignal) =>
    getJson<RepoCommits>(`${repoUrl(repo, 'commits')}?limit=${limit}`, signal),

  file: (
    repo: string,
    comparison: Comparison,
    filePath: string,
    oldPath: string | undefined,
    signal?: AbortSignal,
  ) => {
    const params = comparisonParams(comparison)
    params.set('path', filePath)
    if (oldPath) params.set('oldPath', oldPath)
    return getJson<FileDiff>(`${repoUrl(repo, 'file')}?${params}`, signal)
  },

  refresh: () => getJson<{ changed: string[] }>('/api/refresh'),
}
