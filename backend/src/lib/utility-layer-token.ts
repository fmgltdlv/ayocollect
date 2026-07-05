import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../types';

const TOKEN_TTL = '10m';

async function tokenSecret(env: Env): Promise<Uint8Array> {
  const raw = (await env.INGEST_SECRET?.get()) ?? env.GOOGLE_CLIENT_ID ?? 'utility-layers-dev';
  return new TextEncoder().encode(raw);
}

export async function createUtilityFileToken(env: Env, email: string): Promise<string> {
  return new SignJWT({ sub: email, scope: 'utility-layer-file' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(await tokenSecret(env));
}

export async function verifyUtilityFileToken(env: Env, token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, await tokenSecret(env));
    return payload.scope === 'utility-layer-file';
  } catch {
    return false;
  }
}
