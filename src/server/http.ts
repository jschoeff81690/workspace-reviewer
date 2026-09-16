import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

/** Serve a file out of `rootDir`, with `index.html` as the SPA fallback. */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string,
  urlPath: string,
): Promise<void> {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const candidate = path.join(rootDir, decoded === '/' ? 'index.html' : decoded)
  const resolved = path.resolve(candidate)
  if (!resolved.startsWith(path.resolve(rootDir))) {
    sendError(res, 403, 'forbidden')
    return
  }

  let target = resolved
  try {
    const info = await stat(target)
    if (info.isDirectory()) target = path.join(target, 'index.html')
  } catch {
    target = path.join(rootDir, 'index.html')
  }

  try {
    const info = await stat(target)
    const ext = path.extname(target)
    const immutable = target.includes(`${path.sep}assets${path.sep}`)
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(target).pipe(res)
  } catch {
    sendError(res, 404, 'not found')
  }
}

export interface SseClient {
  send: (event: string, data: unknown) => void
  close: () => void
}

export function openSse(req: IncomingMessage, res: ServerResponse): SseClient {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write('retry: 1500\n\n')

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n')
  }, 25_000)

  const client: SseClient = {
    send: (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    close: () => {
      clearInterval(heartbeat)
      res.end()
    },
  }
  req.on('close', () => clearInterval(heartbeat))
  return client
}
