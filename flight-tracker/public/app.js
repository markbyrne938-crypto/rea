"use strict";
const $ = (s) => document.querySelector(s);
const map = L.map("map", { zoomControl: false, worldCopyJump: true, preferCanvas: false }).setView([40.7, -74], 8);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  { maxZoom: 18, subdomains: "abcd", attribution: "© OpenStreetMap, © CARTO · ADS-B: airplanes.live / adsb.lol" }).addTo(map);

// Rotorcraft: ADS-B emitter category A7, or well-known ICAO helicopter type designators.
const HELI = /^(R22|R44|R66|B06|B06T|B105|B212|B214|B222|B407|B412|B427|B429|B430|B47G|EC20|EC25|EC30|EC35|EC45|EC55|EC75|H125|H130|H135|H145|H155|H160|H175|H269|H500|H47|H53|H60|H64|AS32|AS35|AS50|AS55|AS65|A109|A119|A139|A149|A189|S61|S64|S70|S76|S92|MI8|MI24|KA32|UH1|NH90|CH47|EXPL)$/;
const kind = (a) => (a.category === "A7" || HELI.test(a.t ?? "")) ? "heli" : "plane";
const isMil = (a) => (a.dbFlags & 1) === 1;
const isEmerg = (a) => (a.emergency && a.emergency !== "none") || ["7500", "7600", "7700"].includes(a.squawk);
const onGround = (a) => a.alt_baro === "ground";
const alt = (a) => onGround(a) ? 0 : Number(a.alt_baro ?? a.alt_geom ?? 0);

function color(a) {
  if (onGround(a)) return "#38bdf8";
  const f = alt(a);
  return f < 5000 ? "#4ade80" : f < 15000 ? "#facc15" : f < 30000 ? "#fb923c" : "#f472b6";
}
const PLANE = "M12 1l2 8 9 5v2l-9-2.5-.5 5.5 2.5 2v1.5L12 21l-3 1.5V21l2.5-2-.5-5.5L1 16v-2l9-5z";
const HELIP = "M12 4a2 2 0 012 2v3l6 6v2l-6-2v3l2 2v1h-8v-1l2-2v-3l-6 2v-2l6-6V6a2 2 0 012-2zM3 3h18v1.5H3z";
function icon(a, sel) {
  const heli = kind(a) === "heli", s = heli ? 26 : 24, c = isEmerg(a) ? "#ef4444" : color(a);
  return L.divIcon({ className: "ac" + (sel ? " sel" : ""), iconSize: [s, s], iconAnchor: [s / 2, s / 2],
    html: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" style="transform:rotate(${heli ? 0 : a.track ?? 0}deg)">
      <path d="${heli ? HELIP : PLANE}" fill="${c}" stroke="#0f172a" stroke-width="1"/></svg>` });
}

const state = { ac: new Map(), markers: new Map(), trails: new Map(), filter: "all", sel: null, query: "" };
const passes = (a) => {
  const f = state.filter;
  if (f === "plane" && kind(a) !== "plane") return false;
  if (f === "heli" && kind(a) !== "heli") return false;
  if (f === "mil" && !isMil(a)) return false;
  if (f === "emerg" && !isEmerg(a)) return false;
  return true;
};
const label = (a) => (a.flight?.trim() || a.r || a.hex.toUpperCase());

async function refresh() {
  const c = map.getCenter(), b = map.getBounds();
  const nm = Math.min(250, Math.max(10, Math.ceil(c.distanceTo(b.getNorthEast()) / 1852)));
  try {
    const r = await fetch(`/api/aircraft?lat=${c.lat.toFixed(3)}&lon=${c.wrap().lng.toFixed(3)}&nm=${nm}`);
    const j = await r.json();
    const seen = new Set();
    for (const a of j.ac) {
      if (a.lat == null || a.lon == null) continue;
      seen.add(a.hex); state.ac.set(a.hex, a);
      const t = state.trails.get(a.hex) ?? [], last = t[t.length - 1];
      if (!last || last[0] !== a.lat || last[1] !== a.lon) { t.push([a.lat, a.lon]); if (t.length > 120) t.shift(); }
      state.trails.set(a.hex, t);
    }
    // Drop aircraft the feed no longer reports for this view.
    for (const h of [...state.ac.keys()]) if (!seen.has(h)) { state.ac.delete(h); state.trails.delete(h); }
    const badge = $("#badge");
    badge.hidden = j.source !== "demo";
    badge.textContent = "⚠ Simulated traffic – live feeds unreachable";
    render();
  } catch (e) { console.warn(e); }
}

function render() {
  let n = 0, planes = 0, helis = 0;
  for (const [hex, a] of state.ac) {
    const show = passes(a); let m = state.markers.get(hex);
    if (!show) { if (m) { m.remove(); state.markers.delete(hex); } continue; }
    n++; kind(a) === "heli" ? helis++ : planes++;
    if (!m) {
      m = L.marker([a.lat, a.lon], { icon: icon(a, hex === state.sel), riseOnHover: true }).addTo(map);
      m.on("click", () => select(hex));
      m.bindTooltip(() => label(state.ac.get(hex) ?? a), { direction: "right", className: "lbl", offset: [10, 0] });
      state.markers.set(hex, m);
    } else { m.setLatLng([a.lat, a.lon]); m.setIcon(icon(a, hex === state.sel)); }
  }
  for (const [hex, m] of state.markers) if (!state.ac.has(hex)) { m.remove(); state.markers.delete(hex); }
  $("#stats").textContent = `${n} shown · ${planes} airplanes · ${helis} helicopters`;
  if (state.sel) { drawTrail(); fillPanel(); }
}

let trailLine = null;
function drawTrail() {
  const t = state.trails.get(state.sel);
  if (trailLine) trailLine.remove();
  trailLine = t && t.length > 1 ? L.polyline(t, { color: "#fbbf24", weight: 2, opacity: .8 }).addTo(map) : null;
}

const fmt = (v, u = "") => v == null || v === "" ? "—" : `${typeof v === "number" ? Math.round(v).toLocaleString() : v}${u}`;
async function select(hex) {
  const prev = state.sel; state.sel = hex;
  if (prev && state.markers.get(prev) && state.ac.get(prev)) state.markers.get(prev).setIcon(icon(state.ac.get(prev), false));
  const a = state.ac.get(hex); if (!a) return;
  state.markers.get(hex)?.setIcon(icon(a, true));
  $("#results").hidden = true;
  const p = $("#panel"); p.hidden = false; p.dataset.hex = hex; p.dataset.cs = ""; p.innerHTML = "";
  fillPanel(); drawTrail();
  fetch(`/api/photo/${hex}`).then(r => r.json()).then(ph => {
    if (ph) { photos[hex] = ph.thumbnail_large?.src ?? ph.thumbnail?.src; if (state.sel === hex) fillPanel(); }
  }).catch(() => {});
}
const routeCache = {}, photos = {};
function fillPanel() {
  const a = state.ac.get(state.sel), p = $("#panel");
  if (!a) { p.hidden = true; return; }
  const cs = a.flight?.trim();
  if (cs && !(cs in routeCache)) { routeCache[cs] = null; fetch(`/api/route/${cs}`).then(r => r.json()).then(r => { routeCache[cs] = r; fillPanel(); }).catch(() => {}); }
  const r = cs && routeCache[cs];
  const tags = [kind(a) === "heli" ? "Helicopter" : "Airplane", isMil(a) && "Military", isEmerg(a) && `EMERGENCY ${a.squawk ?? ""}`, onGround(a) && "On ground"]
    .filter(Boolean).map(t => `<span class="tag ${/EMERG/.test(t) ? "red" : t === "Military" ? "mil" : ""}">${t}</span>`).join("");
  const vr = a.baro_rate ?? a.geom_rate;
  p.innerHTML = `<button class="x" onclick="closePanel()">✕</button>
    ${photos[a.hex] ? `<img alt="" src="${photos[a.hex]}">` : ""}
    <div class="pad"><h2>${label(a)}</h2>
    <div class="sub">${a.desc ?? a.t ?? "Unknown type"}${a.ownOp ? " · " + a.ownOp : ""}</div>${tags}
    ${r ? `<div class="route"><div>${r.origin.iata_code}<small>${r.origin.municipality}</small></div><span>→</span><div style="text-align:right">${r.destination.iata_code}<small style="margin-left:auto">${r.destination.municipality}</small></div></div>
      <div class="sub">${r.airline?.name ?? ""}</div>` : ""}
    <div class="grid">
      <div><span>Altitude</span>${onGround(a) ? "Ground" : fmt(alt(a), " ft")}</div>
      <div><span>Ground speed</span>${fmt(a.gs, " kt")}</div>
      <div><span>Heading</span>${fmt(a.track, "°")}</div>
      <div><span>Vertical rate</span>${fmt(vr, " ft/min")}</div>
      <div><span>Registration</span>${fmt(a.r)}</div>
      <div><span>Type</span>${fmt(a.t)}</div>
      <div><span>Squawk</span>${fmt(a.squawk)}</div>
      <div><span>ICAO hex</span>${a.hex.toUpperCase()}</div>
      <div><span>Position</span>${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}</div>
      <div><span>Last seen</span>${fmt(a.seen, " s ago")}</div>
    </div></div>`;
}
window.closePanel = () => { const h = state.sel; state.sel = null; $("#panel").hidden = true; trailLine?.remove(); trailLine = null;
  if (h && state.ac.get(h) && state.markers.get(h)) state.markers.get(h).setIcon(icon(state.ac.get(h), false)); };

// Search over aircraft currently in view.
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase(), ul = $("#results");
  if (!q) { ul.hidden = true; return; }
  const hits = [...state.ac.values()].filter(a => [a.flight, a.r, a.hex, a.t, a.desc].some(v => v?.toLowerCase().includes(q))).slice(0, 25);
  ul.innerHTML = hits.map(a => `<li data-h="${a.hex}"><span>${label(a)} <small>${a.t ?? ""}</small></span><small>${kind(a) === "heli" ? "🚁" : "✈"} ${onGround(a) ? "gnd" : fmt(alt(a), " ft")}</small></li>`).join("") || "<li>No match in current view</li>";
  ul.hidden = false;
});
$("#results").addEventListener("click", (e) => { const li = e.target.closest("li[data-h]"); if (!li) return;
  const a = state.ac.get(li.dataset.h); map.setView([a.lat, a.lon], Math.max(map.getZoom(), 10)); select(a.hex); });
$("#filters").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
  state.filter = b.dataset.f; document.querySelectorAll("#filters button").forEach(x => x.classList.toggle("on", x === b)); render(); });

// Fetch on movement (debounced) and every 5 s; start at the user's location if allowed.
let deb; map.on("moveend", () => { clearTimeout(deb); deb = setTimeout(refresh, 400); });
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
navigator.geolocation?.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 9), () => {}, { timeout: 4000 });
refresh();
