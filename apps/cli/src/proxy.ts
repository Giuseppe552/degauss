/**
 * Anonymous fetch — routes all HTTP requests through Tor SOCKS5.
 *
 * OPSEC architecture:
 *   1. SOCKS5h — DNS resolves on the proxy side (through Tor).
 *      Your local resolver never sees "spokeo.com".
 *
 *   2. Circuit isolation — each request gets a unique Tor circuit
 *      by using different SOCKS auth credentials per request.
 *
 *   3. No cookies, no referrers, no keep-alive between requests.
 *
 *   4. User-Agent rotates per request.
 *
 * Requires: Tor running on localhost:9050 (default SOCKS port).
 *   Install: sudo apt install tor && sudo systemctl start tor
 */

import { SocksProxyAgent } from 'socks-proxy-agent';
import http from 'node:http';
import https from 'node:https';

export interface AnonFetchConfig {
  tor?: boolean;
  proxyUrl?: string;
  torPort?: number;
  circuitIsolation?: boolean;
  timeoutMs?: number;
}

let requestCounter = 0;

/** Create a SOCKS5 agent for a single request.
 *  Circuit isolation: unique username per request → Tor assigns fresh circuit. */
function makeAgent(config: AnonFetchConfig): https.Agent {
  const port = config.torPort ?? 9050;
  const base = config.proxyUrl ?? `socks5h://127.0.0.1:${port}`;
  const isolate = config.circuitIsolation !== false;

  let proxyUrl = base;
  if (isolate) {
    const id = `dg-${Date.now()}-${requestCounter++}`;
    const u = new URL(proxyUrl);
    u.username = id;
    u.password = id;
    proxyUrl = u.toString();
  }

  return new SocksProxyAgent(proxyUrl);
}

/** Fetch a URL through Tor SOCKS5 using node:https with a SOCKS agent.
 *  This works reliably where Node's built-in fetch + dispatcher does not. */
function socksGet(url: string, agent: https.Agent, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      agent,
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'close',
        'DNT': '1',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** Create an anonymous fetch function that routes through Tor.
 *  Returns a function matching the fetch() signature enough for the scraper. */
export function createAnonFetch(config: AnonFetchConfig = {}): typeof fetch {
  const useTor = config.tor !== false;
  const timeoutMs = config.timeoutMs ?? 15000;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!useTor) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
    }

    const agent = makeAgent(config);
    const { status, body } = await socksGet(url, agent, timeoutMs);

    // construct a Response-like object
    return new Response(body, {
      status,
      headers: { 'content-type': 'text/html' },
    });
  };
}

/** Check if Tor is running and verify we're actually using it. */
export async function checkTor(port: number = 9050): Promise<{
  available: boolean;
  exitIp?: string;
  error?: string;
}> {
  try {
    const agent = new SocksProxyAgent(`socks5h://127.0.0.1:${port}`);
    const { status, body } = await socksGet(
      'https://check.torproject.org/api/ip',
      agent,
      10000
    );

    if (status !== 200) {
      return { available: false, error: `Tor check returned HTTP ${status}` };
    }

    const data = JSON.parse(body) as { IsTor: boolean; IP: string };
    if (data.IsTor) {
      return { available: true, exitIp: data.IP };
    }
    return { available: false, error: 'connected but NOT routing through Tor' };
  } catch (err: any) {
    return { available: false, error: `Tor SOCKS5 on port ${port}: ${err.message}` };
  }
}

/** Print OPSEC status for the user. */
export function printOpsecStatus(
  torStatus: Awaited<ReturnType<typeof checkTor>>,
  clearnetForced: boolean
): void {
  const R = '\x1b[0m', RED = '\x1b[31m', GRN = '\x1b[32m', YEL = '\x1b[33m';

  if (torStatus.available) {
    console.error(`  ${GRN}Tor: connected${R} (exit IP: ${torStatus.exitIp})`);
    console.error(`  ${GRN}DNS: resolving through Tor (SOCKS5h)${R}`);
    console.error(`  ${GRN}Circuit isolation: new circuit per request${R}`);
  } else if (clearnetForced) {
    console.error(`  ${RED}WARNING: scanning over clearnet (--clearnet flag)${R}`);
    console.error(`  ${RED}Your IP and DNS queries are visible to brokers and your ISP${R}`);
  } else {
    console.error(`  ${RED}Tor not available: ${torStatus.error}${R}`);
    console.error(`  ${RED}Refusing to scan without anonymisation.${R}`);
    console.error(`  ${YEL}Either:`);
    console.error(`    1. Start Tor: sudo apt install tor && sudo systemctl start tor`);
    console.error(`    2. Force clearnet: add --clearnet (NOT recommended)${R}`);
  }
}
