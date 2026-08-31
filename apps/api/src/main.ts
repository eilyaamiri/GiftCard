import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService } from './common/config';

/** Global route prefix. Health probes keep it too: `/api/health`. */
const GLOBAL_PREFIX = 'api';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    /* pino takes over as soon as it is resolved; buffer the boot logs until then. */
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.flushLogs();

  const config = app.get(AppConfigService);

  /* --------------------------------------------------------------- security */
  app.use(
    helmet({
      /* The API serves JSON only; a CSP here would just be decorative. */
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      /* Do not let a payment-return page leak our URL to the gateway. */
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  /*
   * Credentialed CORS with an explicit allow-list — the session cookie must not
   * be readable by an arbitrary origin. `corsOrigins` is derived from
   * WEB_PUBLIC_URL and ADMIN_PUBLIC_URL, never from a wildcard.
   */
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  /* Behind a reverse proxy the client IP must come from X-Forwarded-For, or
   * every rate limit would apply to the proxy instead of the caller. */
  app.set('trust proxy', 1);

  /* ------------------------------------------------------------ HTTP surface */
  /* No URI versioning in the POC: every route is `/api/<module>/...`. Adding a
   * version segment later is a coordinated change, not a per-agent decision. */
  app.setGlobalPrefix(GLOBAL_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      /* Drop unknown keys instead of trusting them ... */
      whitelist: true,
      /* ... and reject outright if the caller sent extras — a renamed field
       * silently ignored is how a price ends up wrong. */
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      /* Validation messages can echo submitted values; suppress in production. */
      disableErrorMessages: config.isProduction,
    }),
  );

  app.enableShutdownHooks();

  /* --------------------------------------------------------------- Swagger */
  if (!config.isProduction) {
    const documentConfig = new DocumentBuilder()
      .setTitle('Barat Pay API')
      .setDescription(
        'Gift cards and international payments. Money is IRR as a digit string; ' +
          'percentages are integer basis points.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'session')
      .addGlobalParameters({
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'Required on payment, quote acceptance, order and fulfillment calls.',
      })
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup(`${GLOBAL_PREFIX}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(
    {
      port: config.port,
      environment: config.nodeEnv,
      docs: config.isProduction ? 'disabled' : `${config.apiPublicUrl}/${GLOBAL_PREFIX}/docs`,
    },
    'Barat Pay API is listening',
  );
}

void bootstrap();
