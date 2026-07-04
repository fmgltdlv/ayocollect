import { Container, getContainer } from "@cloudflare/containers";

export class ScraperContainer extends Container {
  sleepAfter = "5m";
  enableInternet = true;
}

interface SecretsStoreBinding {
  get(): Promise<string>;
}

interface Env {
  SCRAPER: DurableObjectNamespace<ScraperContainer>;
  WORKER_URL: string;
  SYSTEMS: string;
  INGEST_SECRET: SecretsStoreBinding;
  SCRAPER_RUN_SECRET?: string;
}

type RunBody = {
  start?: string;
  end?: string;
  mode?: string;
  systems?: string[];
};

function scrapeEnv(
  env: Env,
  ingestSecret: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    SCRAPE_MODE: "yesterday",
    WORKER_URL: env.WORKER_URL,
    INGEST_SECRET: ingestSecret,
    SYSTEMS: env.SYSTEMS ?? "digalert,usan-ca,usan-nv",
    ...overrides,
  };
}

function overridesFromBody(body: RunBody): Record<string, string> {
  const overrides: Record<string, string> = {};
  if (body.systems?.length) {
    overrides.SYSTEMS = body.systems.join(",");
  }
  return overrides;
}

async function startScrape(env: Env, overrides: Record<string, string> = {}): Promise<Response> {
  const container = getContainer(env.SCRAPER);
  try {
    const ingestSecret = (await env.INGEST_SECRET.get())?.trim();
    if (!ingestSecret) {
      return Response.json({ error: "INGEST_SECRET not configured on scraper Worker" }, { status: 500 });
    }
    await container.start({
      envVars: scrapeEnv(env, ingestSecret, overrides),
      enableInternet: true,
    });
    return Response.json({ ok: true, message: "Scrape container started" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "ayocollect-scraper" });
    }

    if (url.pathname === "/run" && request.method === "POST") {
      if (env.SCRAPER_RUN_SECRET) {
        const auth = request.headers.get("Authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (token !== env.SCRAPER_RUN_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      let body: RunBody = {};
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }

      const shared = overridesFromBody(body);

      if (body.mode === "yesterday" || !body.start) {
        return startScrape(env, shared);
      }

      return startScrape(env, {
        ...shared,
        SCRAPE_MODE: "",
        SCRAPE_START: body.start,
        SCRAPE_END: body.end ?? body.start,
      });
    }

    return new Response(
      "ayocollect-scraper — POST /run to trigger a scrape, cron runs daily at 14:00 UTC",
    );
  },

  async scheduled(_event: ScheduledEvent, env: Env) {
    await startScrape(env);
  },
};
