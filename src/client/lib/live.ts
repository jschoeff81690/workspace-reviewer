import { useEffect, useRef, useState } from 'react'

export interface LiveState {
  connected: boolean
  lastChangeAt: number | null
}

/**
 * Subscribe to server change events. Also reloads the page when the server's
 * id changes, so a rebuilt client is picked up without a manual refresh.
 */
export function useLive(onChange: (repos: string[]) => void): LiveState {
  const [connected, setConnected] = useState(false)
  const [lastChangeAt, setLastChangeAt] = useState<number | null>(null)
  const handler = useRef(onChange)
  handler.current = onChange

  useEffect(() => {
    const source = new EventSource('/api/events')
    let serverId: string | null = null

    source.addEventListener('open', () => setConnected(true))
    source.addEventListener('error', () => setConnected(false))

    source.addEventListener('hello', (event) => {
      setConnected(true)
      const next = (JSON.parse((event as MessageEvent<string>).data) as { serverId: string }).serverId
      if (serverId !== null && serverId !== next) {
        window.location.reload()
        return
      }
      serverId = next
    })

    source.addEventListener('change', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { repos: string[] }
      setLastChangeAt(Date.now())
      handler.current(data.repos)
    })

    return () => source.close()
  }, [])

  return { connected, lastChangeAt }
}
