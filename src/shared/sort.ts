/**
 * Case-insensitive, byte-order-within-case name comparison.
 *
 * `localeCompare` ignores punctuation weight, which puts `session_test.go`
 * before `session.go`; git and PR file trees order them the other way, so
 * compare lowercased code points directly instead.
 */
export function compareNames(a: string, b: string): number {
  const lowerA = a.toLowerCase()
  const lowerB = b.toLowerCase()
  if (lowerA < lowerB) return -1
  if (lowerA > lowerB) return 1
  return a < b ? -1 : a > b ? 1 : 0
}
