// Zero-dependency server: static files + a small proxy to open ADS-B community APIs.
// Usage: node server.js   (PORT=8080, DEMO=1 forces simulated traffic)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PORT = Number(process.env.PORT ?? 8080);
const FORCE_DEMO = process.env.DEMO === "1";
const MAX_NM = 250; // upstream limit for /point queries

// Open community feeds exposing the readsb/tar1090 v2 JSON schema.
const PROVIDERS = [
  { name: "airplanes.live", url: (a, o, d) => `https://api.airplanes.live/v2/point/${a}/${o}/${d}` },
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
    if (!FORCE_DEMO) {
      for (const p of PROVIDERS) {
        try {
          const j = await getJson(p.url(q(lat), q(lon), nm));
          return { source: p.name, now: Date.now(), ac: j.ac ?? j.aircraft ?? [] };
        } catch (e) { console.warn("provider failed:", e.message); }
      }
    }
    return { source: "demo", now: Date.now(), ac: demo(lat, lon, nm) };
  });
}

// ---- simulated traffic (clearly flagged source:"demo") ----
const DEMO = [];
function demo(lat, lon, nm) {
  if (!DEMO.length) {
    const types = [["B738","Boeing 737-800","A3"],["A320","Airbus A320","A3"],["B77W","Boeing 777-300ER","A5"],["E75L","Embraer E175","A3"],
      ["C172","Cessna 172","A1"],["EC35","Airbus EC135","A7"],["R44","Robinson R44","A7"],["H60","UH-60 Black Hawk","A7"],["A388","Airbus A380","A5"]];
    const al = ["DAL","UAL","AAL","SWA","BAW","DLH","N","JBU"];
    for (let i = 0; i < 90; i++) {
      const [t, desc, cat] = types[i % types.length], heli = cat === "A7";
      DEMO.push({ hex: (0xa00000 + i * 977).toString(16), flight: heli ? `N${100 + i}HX` : `${al[i % al.length]}${100 + i * 7}`,
        r: `N${200 + i}${"ABCDEFG"[i % 7]}`, t, desc, category: cat, dbFlags: i % 17 === 0 ? 1 : 0,
        dx: (Math.random() - .5) * 2, dy: (Math.random() - .5) * 2, trk: Math.random() * 360,
        alt: heli ? 500 + Math.random() * 2500 : 8000 + Math.random() * 33000, gs: heli ? 80 + Math.random() * 80 : 220 + Math.random() * 280,
        squawk: i === 5 ? "7700" : String(1000 + i * 13), emergency: i === 5 ? "general" : "none" });
    }
  }
  const out = []; const now = Date.now();
  for (const d of DEMO) {
    const dt = (now - (d.t0 ?? now)) / 3.6e6; d.t0 = now;
    d.dy += Math.cos(d.trk * Math.PI / 180) * d.gs * dt / 60; d.dx += Math.sin(d.trk * Math.PI / 180) * d.gs * dt / 60;
    if (Math.abs(d.dx) > 4 || Math.abs(d.dy) > 4) { d.dx *= -.9; d.dy *= -.9; d.trk = (d.trk + 180) % 360; }
    d.trk = (d.trk + (Math.random() - .5) * 2 + 360) % 360;
    out.push({ hex: d.hex, flight: d.flight, r: d.r, t: d.t, desc: d.desc, category: d.category, dbFlags: d.dbFlags,
      lat: lat + d.dy, lon: lon + d.dx / Math.max(.2, Math.cos(lat * Math.PI / 180)), alt_baro: Math.round(d.alt), gs: Math.round(d.gs),
      track: d.trk, baro_rate: Math.round((Math.random() - .5) * 1500), squawk: d.squawk, emergency: d.emergency, seen: 0.5 });
  }
  return out;
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
    send(res, e.code === "ENOENT" ? 404 : 500, e.code === "ENOENT" ? "not found" : "error", "text/plain");
  }
}).listen(PORT, () => console.log(`Flight tracker on http://localhost:${PORT}${FORCE_DEMO ? " (demo traffic)" : ""}`));
