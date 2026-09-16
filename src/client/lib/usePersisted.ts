import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'ws-reviewer:'

/** useState backed by localStorage, so a live reload keeps the UI where it was. */
export function usePersisted<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })

  // Persist in an effect rather than inside the updater, which React may call
  // more than once for a single update.
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Private browsing or a full quota: keep working in memory.
    }
  }, [key, value])

  return [value, useCallback((next: T | ((prev: T) => T)) => setValue(next as T), [])]
}
