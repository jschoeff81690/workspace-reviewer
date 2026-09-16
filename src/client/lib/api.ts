import type { CompareMode, FileDiff, RepoChanges, WorkspaceInfo } from '../../shared/types.ts'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok || body.error) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  return body
}

export const api = {
  workspace: (signal?: AbortSignal) => getJson<WorkspaceInfo>('/api/workspace', signal),

  changes: (repo: string, mode: CompareMode, signal?: AbortSignal) =>
    getJson<RepoChanges>(`/api/repos/${encodeURIComponent(repo)}/changes?mode=${mode}`, signal),

  file: (
    repo: string,
    mode: CompareMode,
    filePath: string,
    oldPath: string | undefined,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ mode, path: filePath })
    if (oldPath) params.set('oldPath', oldPath)
    return getJson<FileDiff>(`/api/repos/${encodeURIComponent(repo)}/file?${params}`, signal)
  },

  refresh: () => getJson<{ changed: string[] }>('/api/refresh'),
}
