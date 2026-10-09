// Zero-dependency server: static files + a small proxy to open ADS-B community APIs.
// Usage: node server.js   (PORT=8080)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PORT = Number(process.env.PORT ?? 8080);
const MAX_NM = 250; // upstream limit for /point queries

// Open community feed exposing the readsb/tar1090 v2 JSON schema.
const PROVIDERS = [
  { name: "adsb.lol", url: (a, o, d) => `https://api.adsb.lol/v2/point/${a}/${o}/${d}` },
];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const cache = new Map(); // key -> { t, body }
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.body;
  const body = await fn();
  cache.set(key, { t: Date.now(), body });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return body;
}
const getJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "local-flight-tracker/1.0" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};

async function aircraft(lat, lon, nm) {
  // Snap to a coarse grid so concurrent viewers share one upstream request.
  const q = (v) => (Math.round(v * 4) / 4).toFixed(2);
  return cached(`ac:${q(lat)}:${q(lon)}:${nm}`, 1500, async () => {
    for (const p of PROVIDERS) {
      try {
        const j = await getJson(p.url(q(lat), q(lon), nm));
        return { source: p.name, now: Date.now(), ac: j.ac ?? j.aircraft ?? [] };
      } catch (e) { console.warn("provider failed:", e.message); }
    }
    throw Object.assign(new Error("all live feeds unreachable"), { upstream: true });
  });
}

// ---- lookups (cached): route by callsign, photo by hex ----
const route = (cs) => cached(`rt:${cs}`, 6 * 3.6e6, async () => {
  try { const r = (await getJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`)).response?.flightroute; return r ?? null; }
  catch { return null; }
});
const photo = (hex) => cached(`ph:${hex}`, 24 * 3.6e6, async () => {
  try { return (await getJson(`https://api.planespotters.net/pub/photos/hex/${hex}`)).photos?.[0] ?? null; }
  catch { return null; }
});

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/healthz") return send(res, 200, { ok: true });
    if (u.pathname === "/api/aircraft") {
      const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
      const nm = Math.min(MAX_NM, Math.max(1, Math.round(Number(u.searchParams.get("nm") ?? 100))));
      if (![lat, lon, nm].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return send(res, 400, { error: "bad lat/lon/nm" });
      return send(res, 200, await aircraft(lat, lon, nm));
    }
    let m;
    if ((m = u.pathname.match(/^\/api\/route\/([A-Za-z0-9]{2,10})$/))) return send(res, 200, await route(m[1].toUpperCase()));
    if ((m = u.pathname.match(/^\/api\/photo\/([0-9a-fA-F]{6})$/))) return send(res, 200, await photo(m[1].toLowerCase()));
    const rel = normalize(u.pathname === "/" ? "/index.html" : u.pathname);
    if (rel.includes("..")) return send(res, 403, "forbidden", "text/plain");
    send(res, 200, await readFile(join(PUBLIC, rel)), MIME[extname(rel)] ?? "application/octet-stream");
  } catch (e) {
    if (e.upstream) return send(res, 502, { error: e.message });
    send(res, e.code === "ENOENT" ? 404 : 500, e.code === "ENOENT" ? "not found" : "error", "text/plain");
  }
}).listen(PORT, () => console.log(`Flight tracker on http://localhost:${PORT}`));
