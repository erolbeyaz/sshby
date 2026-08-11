import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, pool } from './client.js';
import { logger } from '../lib/logger.js';

/**
 * Düz SQL migration uygulayıcı.
 *
 * drizzle-kit'in üretici akışı yerine elle yazılmış SQL dosyaları kullanıyoruz:
 * şemanın ne zaman ne olacağı gözle görülür, üretimde sürpriz DDL çıkmaz ve
 * çalışma zamanında drizzle-kit bağımlılığı taşımayız. Şema tipleri yine
 * `schema.ts`ten gelir; `pnpm db:diff` ile drizzle-kit'e fark aldırıp çıktıyı
 * buraya yeni bir dosya olarak eklemek serbest.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

const CREATE_TABLE = `
  create table if not exists schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )
`;

export async function runMigrations(): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const client = await pool.connect();
  try {
    await client.query(CREATE_TABLE);

    // Aynı anda birden fazla migration Job'ı çalışırsa ikisi de DDL denemesin.
    // Danışmanlık kilidi bağlantı kapanınca kendiliğinden bırakılır.
    await client.query('select pg_advisory_lock($1)', [0x5353_4842]);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);

      if (previous) {
        if (previous !== checksum) {
          // Uygulanmış bir migration'ı sonradan düzenlemek, ortamlar arasında
          // sessizce farklı şemalara yol açar. Sessiz kalmaktansa duruyoruz.
          throw new Error(
            `${file} daha önce uygulanmış ama içeriği değişmiş. ` +
              'Uygulanmış migration düzenlenemez; yeni bir dosya ekleyin.',
          );
        }
        continue;
      }

      logger.info({ file }, 'Migration uygulanıyor');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }

    logger.info({ total: files.length }, 'Migration tamamlandı');
  } finally {
    client.release();
  }
}

// Bu dosya yalnızca CLI olarak çalıştırılır (`pnpm db:migrate`, compose
// başlangıcı, Helm pre-upgrade hook'u). Kütüphane olarak kullanılmaz.
runMigrations()
  .then(() => closeDatabase())
  .catch(async (err: unknown) => {
    logger.error({ err }, 'Migration başarısız');
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
