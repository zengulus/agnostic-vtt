import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { FilePersistence, SupabasePersistence } from './persistence.js';
import { LocalAuth, SupabaseAuth } from './auth.js';
import { RoomManager } from './rooms.js';
import { createApp } from './app.js';
import { FileAssetStorage, SupabaseAssetStorage } from './assets.js';

const mode = process.env.AUTH_MODE || 'local';
if (!['local', 'supabase'].includes(mode)) throw new Error('AUTH_MODE must be local or supabase.');
if (mode === 'local' && process.env.NODE_ENV === 'production')
  throw new Error(
    'Production requires Supabase authentication. Local guest mode is only for development.',
  );
const dir = process.env.LOCAL_DATA_DIR || '.data';
async function localSecret() {
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'auth-secret');
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const secret = randomBytes(32).toString('hex');
    await writeFile(path, secret, { mode: 0o600 });
    return secret;
  }
}
const cloud = mode === 'supabase';
if (cloud && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY))
  throw new Error('Set Supabase URL and the server-only service role key.');
const storage = cloud
  ? new SupabasePersistence(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  : new FilePersistence(dir);
const auth =
  storage instanceof SupabasePersistence
    ? new SupabaseAuth(storage.client)
    : new LocalAuth(await localSecret());
const manager = new RoomManager(
  storage,
  Math.max(1000, Number(process.env.SNAPSHOT_INTERVAL_MS) || 90000),
  Math.max(100, Number(process.env.PERSIST_DEBOUNCE_MS) || 5000),
);
const origins = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const assetStorage =
  storage instanceof SupabasePersistence
    ? new SupabaseAssetStorage(storage.client)
    : new FileAssetStorage(dir);
const app = createApp(manager, auth, origins, assetStorage);
const port = Number(process.env.PORT) || 3001,
  host = process.env.HOST || (cloud ? '0.0.0.0' : '127.0.0.1');
app.server.listen(port, host, () =>
  console.log(
    `Aether multiplayer listening at http://${host}:${port} (${mode}; snapshots ${manager.interval}ms)`,
  ),
);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
    setTimeout(() => process.exit(1), 10000).unref();
  });
