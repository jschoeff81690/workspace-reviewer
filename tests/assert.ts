let passed = 0
const failures: string[] = []
let current = 'general'

export function suite(name: string): void {
  current = name
  process.stdout.write(`\n${name}\n`)
}

export function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++
    process.stdout.write(`  ok   ${label}\n`)
    return
  }
  failures.push(`${current}: ${label}${detail === undefined ? '' : `\n       ${JSON.stringify(detail)}`}`)
  process.stdout.write(`  FAIL ${label}\n`)
  if (detail !== undefined) process.stdout.write(`       ${JSON.stringify(detail)}\n`)
}

export function equal<T>(label: string, actual: T, expected: T): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  check(label, same, same ? undefined : { actual, expected })
}

export function finish(): void {
  process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`)
  if (failures.length > 0) {
    process.stdout.write(`\n${failures.join('\n')}\n`)
    process.exitCode = 1
  }
}
