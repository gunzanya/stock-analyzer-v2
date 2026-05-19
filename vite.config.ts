import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
import type { Connect } from 'vite'

// Forward /api/* to the local dev API server (scripts/dev-api.mjs on port
// 3001) BEFORE Vite's transform middleware can see the request — otherwise
// Vite tries to serve `api/analyze.ts` as a TypeScript module.
function devApiProxy(target = 'http://localhost:3001') {
  return {
    name: 'dev-api-proxy',
    configureServer(server: { middlewares: Connect.Server }) {
      const handler: Connect.NextHandleFunction = (req, res) => {
        // server.middlewares.use('/api', ...) strips '/api' from req.url —
        // restore it for the upstream request.
        const url = `${target}/api${req.url ?? '/'}`
        const proxyReq = http.request(
          url,
          { method: req.method, headers: req.headers },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
            proxyRes.pipe(res)
          },
        )
        proxyReq.on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({ error: 'dev_api_proxy_error', message: err.message }),
          )
        })
        req.pipe(proxyReq)
      }
      server.middlewares.use('/api', handler)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApiProxy()],
})
