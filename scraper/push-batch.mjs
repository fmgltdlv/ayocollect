#!/usr/bin/env node
/**
 * POST a JSON batch file to ayocollect Worker ingest API.
 *
 * Usage:
 *   node scraper/push-batch.mjs --url URL --secret SECRET --system digalert|usan-ca|usan-nv \
 *     --batch-id my-batch-1 --file batch.json
 */

const systems = {
  digalert: '/api/ingest/digalert',
  'usan-ca': '/api/ingest/usan-ca',
  'usan-nv': '/api/ingest/usan-nv',
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = (arg('url') ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
  const secret = arg('secret') ?? process.env.INGEST_SECRET;
  const system = arg('system');
  const batchId = arg('batch-id');
  const file = arg('file');

  if (!secret) {
    console.error('Missing --secret or INGEST_SECRET env');
    process.exit(1);
  }
  if (!system || !systems[system]) {
    console.error('--system must be digalert, usan-ca, or usan-nv');
    process.exit(1);
  }
  if (!file) {
    console.error('--file required (JSON with tickets array)');
    process.exit(1);
  }

  const fs = await import('node:fs/promises');
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const body = {
    batchId: batchId ?? raw.batchId ?? `manual-${Date.now()}`,
    scrapedAt: raw.scrapedAt ?? new Date().toISOString(),
    tickets: raw.tickets ?? raw,
  };

  if (!Array.isArray(body.tickets)) {
    console.error('JSON must contain a tickets array');
    process.exit(1);
  }

  const res = await fetch(`${url}${systems[system]}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  console.log(res.status, JSON.stringify(data, null, 2));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
