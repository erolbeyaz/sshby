import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from 'fastify';
import type { ZodError } from 'zod';
import { env, isProduction } from './env.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { registerAuthPlugin } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBootstrapRoutes } from './routes/bootstrap.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerCredentialRoutes } from './routes/credentials.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerSftpRoutes } from './routes/sftp.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTerminalHttpRoutes, registerTerminalWsRoutes } from './routes/terminal.js';
import { registerUserRoutes } from './routes/users.js';

function isZodError(error: unknown): error is ZodError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // pino'nun Logger tipi Fastify'ın beklediğinden daha dar; daraltmazsak
    // FastifyInstance jeneriği kayıyor ve eklenti/route tipleri uyuşmuyor.
    loggerInstance: logger as FastifyBaseLogger,
    // Ters vekil (nginx / ingress) arkasında çalışıyoruz; istemci IP'sini
    // denetim kaydına doğru yazabilmek için X-Forwarded-For'a güveniyoruz.
    trustProxy: true,
    disableRequestLogging: false,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    // SPA'yı nginx servis ediyor; API yanıtları için CSP gereksiz ve
    // WebSocket yükseltmesini karmaşıklaştırıyor.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // Üretimde web ve api aynı origin altında (nginx /api'yi proxy'liyor), bu
  // yüzden CORS'a gerek yok. Yalnızca Vite dev sunucusu için açılır.
  if (!isProduction && env.DEV_CORS_ORIGIN) {
    await app.register(cors, { origin: env.DEV_CORS_ORIGIN, credentials: true });
  }

  await app.register(cookie);

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });

  await app.register(websocket, {
    options: {
      /**
       * Terminal çerçeveleri küçük ama SFTP yükleme parçaları büyük olabilir.
       * Sınır, kötü niyetli bir istemcinin tek çerçeveyle belleği doldurmasını
       * engelliyor.
       */
      maxPayload: 8 * 1024 * 1024,
    },
  });

  /**
   * DİKKAT: Hata ve 404 yöneticileri route kaydından ÖNCE kurulmalı. Fastify'da
   * alt kapsamlar bu yöneticileri kayıt anında miras alır; sonradan set etmek
   * yalnızca kök kapsamı etkiler ve /api altındaki route'lar varsayılan
   * serileştiriciyle yanıt vermeye devam eder.
   */
  // Parametre tipi açıkça yazılıyor: aksi hâlde `unknown` olarak çıkarsanıyor.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      // Beklenen hata: gürültü yapmadan, kullanıcıya anlamlı mesajla dön.
      request.log.debug({ code: error.code }, error.message);
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }

    /**
     * `instanceof ZodError` kullanmıyoruz: @sshby/shared kendi zod kopyasını
     * taşıyabildiği için şema oradan geldiğinde sınıf kimliği tutmuyor ve hata
     * sessizce 500'e düşüyordu. Yapısal kontrol her iki kopyada da çalışır.
     */
    if (isZodError(error)) {
      return reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: 'Gönderilen veri geçersiz.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code ?? 'bad_request', message: error.message } });
    }

    request.log.error({ err: error }, 'Beklenmeyen hata');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Beklenmeyen bir hata oluştu.' },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'not_found', message: `Bilinmeyen uç: ${request.method} ${request.url}` },
    }),
  );

  // Dekoratörler kök örneğe eklenir; alt kapsamdaki route'lar bunları miras alır.
  registerAuthPlugin(app);

  await app.register(
    async (api) => {
      await registerHealthRoutes(api);
      await registerBootstrapRoutes(api);
      await registerAuthRoutes(api);
      await registerUserRoutes(api);
      await registerSettingsRoutes(api);
      await registerCredentialRoutes(api);
      await registerInventoryRoutes(api);
      await registerConfigRoutes(api);
      await registerSftpRoutes(api);
      await registerMetricsRoutes(api);
      await registerHistoryRoutes(api);
      await registerDashboardRoutes(api);
      await registerTerminalHttpRoutes(api);
    },
    { prefix: '/api' },
  );

  // WebSocket'ler ayrı önekte — gerekçesi routes/terminal.ts içinde.
  await app.register(async (ws) => registerTerminalWsRoutes(ws), { prefix: '/ws' });

  return app;
}
