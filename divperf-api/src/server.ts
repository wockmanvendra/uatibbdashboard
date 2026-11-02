import Fastify, { LogController } from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { cachePlugin } from './plugins/cache.js';
import { authPlugin } from './plugins/auth.js';
import { scopePlugin } from './plugins/scope.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { metaRoutes } from './routes/meta.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { detailRoutes } from './routes/details.js';
import { startCacheWarmer } from './services/cacheWarmer.js';
import { AppError, serialiseError, tooManyRequests } from './lib/errors.js';

export async function buildServer() {
  const loggerOptions = {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  };

  const app = Fastify({
    logger: loggerOptions,
    // The web app's /api proxy runs on this machine and passes the browser's
    // address in X-Forwarded-For. Trusting it from loopback only means each
    // user gets their own sign-in rate limit and audit IP, while a request
    // from anywhere else cannot claim another address.
    trustProxy: '127.0.0.1',
    routerOptions: {
      // Repeated query params (?zone=A&zone=B) must arrive as arrays.
      querystringParser: (str: string) => {
        const out: Record<string, string | string[]> = {};
        for (const [k, v] of new URLSearchParams(str)) {
          const cur = out[k];
          if (cur === undefined) out[k] = v;
          else if (Array.isArray(cur)) cur.push(v);
          else out[k] = [cur, v];
        }
        return out;
      },
    },
    // Per-request access logs are noise in production; the slow-query warnings
    // in tabService are what we actually watch.
    logController: new LogController({
      disableRequestLogging: config.NODE_ENV !== 'development',
    }),
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });

  // Brotli first — the tab payloads are highly compressible columnar arrays. (§7.6)
  await app.register(compress, {
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
  });

  // Only routes that opt in via `config.rateLimit` are limited.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      tooManyRequests(`Too many attempts. Wait ${Math.ceil(ctx.ttl / 60_000)} minute(s) and try again.`),
  });


  await app.register(cachePlugin);
  // Auth before scope: onRequest hooks run in registration order.
  await app.register(authPlugin);
  await app.register(scopePlugin);

  // Must be set BEFORE the route plugins: an encapsulated context inherits the
  // error handler that exists when it is created, so registering routes first
  // leaves them on Fastify's default serializer and leaks `statusCode`/`error`
  // fields that are not in the contract.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      req.log.warn({ code: err.code, detail: err.detail, url: req.url }, err.message);
      return reply.status(err.statusCode).send(serialiseError(err));
    }
    // Never leak SQL or a stack trace to the client. (§7.5)
    req.log.error({ err, url: req.url }, 'unhandled error');
    return reply.status(500).send(serialiseError(err));
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}.` },
    }),
  );

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(metaRoutes);
  await app.register(dashboardRoutes);
  await app.register(detailRoutes);

  return app;
}

export async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    if (config.USE_MOCK_DATA) {
      app.log.warn(
        'USE_MOCK_DATA=true — serving generated data. The serving database ' +
          '(ARCHITECTURE.md §4.8) is not provisioned yet.',
      );
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Rebuilds cached views whenever the source data changes. Started here, not
  // in buildServer(), so tests never run it.
  const stopWarmer = startCacheWarmer(app);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      app.log.info(`${sig} received, closing`);
      stopWarmer();
      void app.close().then(() => process.exit(0));
    });
  }
}

// Only start a server when run directly, so tests can import buildServer().
// A process manager that loads this file through its own wrapper (PM2) has a
// different argv[1], so it starts the server through start.ts instead.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  void main();
}
