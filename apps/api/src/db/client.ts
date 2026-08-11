import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  // Uzun ömürlü WS pod'larında sızıntıyı önlemek için boşta kalan bağlantıyı bırak.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;

export async function pingDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select 1');
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
