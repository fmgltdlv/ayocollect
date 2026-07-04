import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

type AuthEnv = { Bindings: Env; Variables: { userEmail: string } };

export function authDisabled(env: Env): boolean {
  const v = env.AUTH_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  allowedDomain: string
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });
    if (!payload.email || payload.email_verified !== true) return null;

    const email = String(payload.email).toLowerCase();
    const domain = allowedDomain.toLowerCase().replace(/^@/, '');
    const hd = payload.hd ? String(payload.hd).toLowerCase() : '';
    if (hd && hd !== domain) return null;
    if (!email.endsWith(`@${domain}`)) return null;

    return { email };
  } catch {
    return null;
  }
}

export function requireGoogleAuth(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    if (authDisabled(c.env)) return next();

    const clientId = c.env.GOOGLE_CLIENT_ID?.trim();
    const domain = c.env.ALLOWED_EMAIL_DOMAIN?.trim();
    if (!clientId || !domain) {
      return c.json({ error: 'Auth not configured — set GOOGLE_CLIENT_ID and ALLOWED_EMAIL_DOMAIN' }, 503);
    }

    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const user = await verifyGoogleIdToken(token, clientId, domain);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    c.set('userEmail', user.email);
    await next();
  };
}
