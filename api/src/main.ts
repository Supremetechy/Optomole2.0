import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { gatewayConfig } from './shared/config';

async function bootstrap() {
  const config = gatewayConfig();

  let httpsOptions: { cert: Buffer; key: Buffer } | undefined;
  if (config.gatewayHttps) {
    const certPath = path.resolve(process.cwd(), config.tlsCertPath);
    const keyPath = path.resolve(process.cwd(), config.tlsKeyPath);
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      httpsOptions = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[gateway] GATEWAY_HTTPS=true but certs not found at ${certPath} / ${keyPath}. ` +
          'Run `browser-engine/serve.py --https` once to generate them (or set ' +
          'TLS_CERT_PATH / TLS_KEY_PATH). Falling back to HTTP.',
      );
    }
  }

  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    ...(httpsOptions ? { httpsOptions } : {}),
  });

  // Raw binary body for worker artifact uploads (engine-build zips), registered
  // BEFORE the JSON parser so that path receives a Buffer, not parsed JSON. The
  // parser sets req._body, so the JSON parser below skips it.
  app.use('/v1/workers/artifacts', express.raw({ type: () => true, limit: config.bodyLimit }));
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ limit: config.bodyLimit, extended: true }));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-eval'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: [
          "'self'",
          'http://localhost:8080',
          'http://127.0.0.1:8080',
          'https://localhost:8080',
          'https://127.0.0.1:8080',
          'https://cdn.jsdelivr.net',
        ],
        mediaSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        // Helmet's defaults add `upgrade-insecure-requests`, which forces the
        // browser to rewrite every http:// subresource to https://. When the
        // gateway runs over plain HTTP (GATEWAY_HTTPS=false) that upgrade points
        // boot.js / PixiJS / the manifest fetch at an https listener that isn't
        // there, so the playable dies with ERR_SSL_PROTOCOL_ERROR — but only
        // when the console is reached by a non-loopback host (a LAN IP), since
        // Chrome exempts localhost from the upgrade. Drop the directive on HTTP
        // and keep it when we actually serve TLS.
        upgradeInsecureRequests: config.gatewayHttps ? [] : null,
      },
    },
  }));
  app.enableCors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((origin) => origin.trim()),
  });
  app.setGlobalPrefix('v1');

  const browserEngineRoot = path.resolve(process.cwd(), config.browserEnginePath);
  app.use('/v1/browser-engine', express.static(browserEngineRoot));

  // GameDuplicator, served so it can share the gateway origin in a standalone /
  // prod deploy (the Vite dev server serves it at /gameduplicator for local dev).
  const gameDuplicatorRoot = path.resolve(process.cwd(), config.gameDuplicatorPath);
  app.use('/v1/gameduplicator', express.static(gameDuplicatorRoot));

  const swagger = new DocumentBuilder()
    .setTitle('Optimole API Gateway')
    .setDescription('Experience Fabric gateway for AI generation, build queues, engine workers, and playable launch sessions.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('/docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(config.port, '0.0.0.0');
  
  // eslint-disable-next-line no-console
  // console.log(`[gateway] listening on ${httpsOptions ? 'https' : 'http'}://localhost:${config.port} (engine at /v1/browser-engine)`);
}

void bootstrap();
