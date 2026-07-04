import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

type AdminEnv = { Bindings: Env; Variables: { userEmail: string; isAdmin: boolean } };

export type AdminUser = {
  email: string;
  created_at: string;
  created_by: string | null;
  source: 'db' | 'env';
};

function parseEnvAdmins(env: Env): Set<string> {
  const raw = env.ADMIN_EMAILS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function isAdminEmail(db: D1Database, env: Env, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (parseEnvAdmins(env).has(normalized)) return true;
  const row = await db
    .prepare('SELECT email FROM admin_users WHERE email = ?')
    .bind(normalized)
    .first<{ email: string }>();
  return !!row;
}

export async function listAdminUsers(db: D1Database, env: Env): Promise<AdminUser[]> {
  const envAdmins = parseEnvAdmins(env);
  const rows = await db
    .prepare('SELECT email, created_at, created_by FROM admin_users ORDER BY email')
    .all<{ email: string; created_at: string; created_by: string | null }>();

  const byEmail = new Map<string, AdminUser>();
  for (const email of envAdmins) {
    byEmail.set(email, { email, created_at: '', created_by: null, source: 'env' });
  }
  for (const row of rows.results ?? []) {
    const email = row.email.toLowerCase();
    byEmail.set(email, {
      email,
      created_at: row.created_at,
      created_by: row.created_by,
      source: envAdmins.has(email) ? 'env' : 'db',
    });
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export async function addAdminUser(
  db: D1Database,
  email: string,
  createdBy: string
): Promise<AdminUser> {
  const normalized = email.trim().toLowerCase();
  await db
    .prepare('INSERT INTO admin_users (email, created_by) VALUES (?, ?)')
    .bind(normalized, createdBy)
    .run();
  const row = await db
    .prepare('SELECT email, created_at, created_by FROM admin_users WHERE email = ?')
    .bind(normalized)
    .first<{ email: string; created_at: string; created_by: string | null }>();
  return { ...(row ?? { email: normalized, created_at: '', created_by: createdBy }), source: 'db' };
}

export async function removeAdminUser(db: D1Database, env: Env, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (parseEnvAdmins(env).has(normalized)) return false;
  const result = await db.prepare('DELETE FROM admin_users WHERE email = ?').bind(normalized).run();
  return (result.meta.changes ?? 0) > 0;
}

export function isEnvAdmin(env: Env, email: string): boolean {
  return parseEnvAdmins(env).has(email.trim().toLowerCase());
}

export function requireAdmin(): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const email = c.get('userEmail');
    if (!email) return c.json({ error: 'Forbidden — admin access required' }, 403);

    const admin = await isAdminEmail(c.env.DB, c.env, email);
    if (!admin) return c.json({ error: 'Forbidden — admin access required' }, 403);

    c.set('isAdmin', true);
    await next();
  };
}
