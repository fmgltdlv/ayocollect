export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .bind(key, value)
    .run();
}

export async function isFetchStopped(db: D1Database): Promise<boolean> {
  return (await getSetting(db, 'fetch_stopped')) === '1';
}

export async function setFetchStopped(db: D1Database, stopped: boolean): Promise<void> {
  await setSetting(db, 'fetch_stopped', stopped ? '1' : '0');
}

export async function getAutoFetchSettings(db: D1Database) {
  const keys = [
    'auto_fetch_enabled',
    'auto_fetch_time_utc',
    'auto_fetch_include_digalert',
    'auto_fetch_include_usan_ca',
    'auto_fetch_include_usan_nv',
    'auto_fetch_lookback_days',
    'fetch_stopped',
    'auto_fetch_last_run_date',
  ];
  const out: Record<string, string> = {};
  for (const k of keys) {
    out[k] = (await getSetting(db, k)) ?? '';
  }
  return out;
}
