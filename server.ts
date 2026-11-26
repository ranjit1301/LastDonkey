import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createMultiplayerRuntime } from './src/server/wsHandler.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parsedPort = Number(process.env.PORT);
const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;
const isProduction = process.env.NODE_ENV === 'production';

function resolveTrustProxy(raw: string | undefined, prod: boolean): boolean | number {
  if (!raw || raw.trim() === '') return prod ? 1 : false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true') return true;
  const hops = Number(normalized);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return prod ? 1 : false;
}

const runtime = createMultiplayerRuntime();
const { roomManager } = runtime;
const startedAtMs = Date.now();
let isShuttingDown = false;

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY, isProduction));

  // Iframe-safe baseline security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  // Liveness & readiness health check (never exposes room codes, tokens, or player data)
  const handleHealth = (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isShuttingDown) {
      res.status(503).json({
        ok: false,
        status: 'shutting_down',
      });
      return;
    }
    res.status(200).json({
      ok: true,
      status: 'healthy',
      uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
      activeRooms: roomManager.getRoomCount(),
    });
  };
  app.get('/healthz', handleHealth);
  app.get('/api/health', handleHealth);

  // Public Rooms discovery API (never leaks private rooms)
  app.get('/api/rooms/public', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rooms: roomManager.getPublicRooms() });
  });

  // Lightweight bounded per-IP sliding-window rate limiter for room validation
  const validateRateMap = new Map<string, number[]>();
  const VALIDATE_WINDOW_MS = 60_000;
  const VALIDATE_MAX_PER_WINDOW = 30;
  const VALIDATE_MAX_TRACKED_IPS = 2000;

  // Validate room code or invitation link before joining (works even when user isn't logged in)
  app.get('/api/rooms/validate', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (validateRateMap.get(clientIp) ?? []).filter(
      (ts) => now - ts < VALIDATE_WINDOW_MS
    );
    if (recent.length >= VALIDATE_MAX_PER_WINDOW) {
      validateRateMap.set(clientIp, recent);
      res.status(429).json({
        ok: false,
        error: 'Too many room validation requests. Please wait a moment.',
      });
      return;
    }
    recent.push(now);
    validateRateMap.set(clientIp, recent);
    if (validateRateMap.size > VALIDATE_MAX_TRACKED_IPS) {
      const oldestIp = validateRateMap.keys().next().value;
      if (oldestIp) validateRateMap.delete(oldestIp);
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const invite = typeof req.query.invite === 'string' ? req.query.invite : undefined;
    if (!code) {
      res.status(400).json({ ok: false, error: 'Room code is required.' });
      return;
    }
    const result = roomManager.validateRoomAccess(code, invite);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  // Return clean JSON 404 for unknown API paths instead of falling through to index.html
  app.use('/api', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ ok: false, error: 'Endpoint not found.' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  runtime.attach(wss);

  // Mount Vite middleware in dev, or serve static dist in production
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server },
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');

    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          const baseName = path.basename(filePath);
          if (
            baseName === 'index.html' ||
            baseName === 'sw.js' ||
            baseName === 'manifest.webmanifest'
          ) {
            // Ensure PWA updates and new deployments are picked up immediately on refresh
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            // Content-hashed Vite bundles are safe for long-lived immutable caching
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(indexHtmlPath);
    });
  }

  // Safe error-handling middleware (never leaks stack traces or sensitive payloads)
  app.use(
    (
      err: Error & { status?: number; type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (res.headersSent) return;
      if (err.type === 'entity.parse.failed') {
        res.status(400).json({ ok: false, error: 'Invalid JSON request body.' });
        return;
      }
      console.error('[server] Request error:', err.message);
      res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500).json({
        ok: false,
        error: 'Internal server error.',
      });
    }
  );

  server.on('upgrade', (request, socket, head) => {
    if (isShuttingDown) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    let pathname: string;
    try {
      pathname = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? 'localhost'}`
      ).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (isProduction) {
      socket.destroy();
    }
  });

  server.on('error', (err) => {
    console.error('[server] HTTP server error:', err.message);
  });

  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[server] Received ${signal}. Starting graceful shutdown...`);

    // Notify connected WebSocket clients cleanly so their auto-reconnect UI engages immediately
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        try {
          client.close(1001, 'Server restarting');
        } catch {
          client.terminate();
        }
      }
    }

    runtime.dispose();
    wss.close();

    const forceExitTimer = setTimeout(() => {
      console.error('[server] Forced exit after graceful shutdown timeout.');
      process.exit(1);
    }, 5000);
    if (typeof forceExitTimer.unref === 'function') {
      forceExitTimer.unref();
    }

    server.close(() => {
      clearTimeout(forceExitTimer);
      console.log('[server] Shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[server] Unhandled promise rejection:', msg);
  });

  process.on('uncaughtException', (err) => {
    console.error('[server] Uncaught exception:', err.message);
    gracefulShutdown('uncaughtException');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Last Donkey (Rang Vapas) server listening on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start Last Donkey server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
