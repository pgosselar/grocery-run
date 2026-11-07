import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

export class FetchError extends Error {}

// The server sits on the home LAN, so refuse anything that resolves to a private
// address: a recipe URL must never become a way to poke at the router or other boxes.
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT / Tailscale
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivate(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("Only http(s) links work.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new FetchError("Couldn't find that website.");
  if (addrs.some((a) => isPrivate(a.address))) throw new FetchError("That address isn't a public website.");
}

/** Fetch a public web page as text, following redirects safely. */
export async function fetchPage(raw: string): Promise<{ html: string; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchError("That doesn't look like a link.");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GroceryRun/1.0; family recipe importer)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new FetchError(timedOut ? "The website took too long to answer." : "Couldn't reach that website.");
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      throw new FetchError("That website blocks automatic readers. Paste the ingredients instead.");
    }
    if (!res.ok) throw new FetchError(`The website answered with an error (${res.status}).`);

    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new FetchError("That page is too large.");
    const reader = res.body?.getReader();
    if (!reader) throw new FetchError("The page was empty.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new FetchError("That page is too large.");
      }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: url.toString() };
  }
  throw new FetchError("Too many redirects.");
}
