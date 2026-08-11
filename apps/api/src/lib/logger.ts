import { pino } from 'pino';
import { env, isProduction } from '../env.js';

/**
 * Gizli veri loga sızmasın diye geniş bir redaksiyon listesi. Bir alan
 * unutulursa parola ya da özel anahtar düz metin olarak log toplayıcıya gider,
 * bu yüzden liste bilerek fazladan geniş tutuldu.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passphrase',
  '*.privateKey',
  '*.secret',
  '*.token',
  '*.refreshToken',
  '*.apiKey',
  'password',
  'passphrase',
  'privateKey',
  'secret',
  'token',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[gizlendi]' },
  ...(isProduction
    ? {}
    : { transport: { target: 'pino/file', options: { destination: 1 } } }),
});

export type Logger = typeof logger;
