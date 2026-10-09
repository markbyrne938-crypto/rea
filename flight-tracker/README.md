# Skywatch – live air traffic map

A FlightRadar24-style web app for airplanes **and helicopters**: live map, altitude-coloured rotated icons, trails,
search, filters (airplanes / helicopters / military / emergency squawks), and a detail panel with photo, route and telemetry.

    node server.js          # http://localhost:8080  (Node 18+, no dependencies)

Data comes from the open community feed adsb.lol (readsb/tar1090 v2 JSON, unfiltered like ADS-B Exchange),
with routes from adsbdb.com and photos from planespotters.net. If both feeds are unreachable the app shows an error and an empty map; it never fabricates traffic.
Check each provider's terms before any public or commercial deployment.

Behind an HTTP proxy (e.g. a cloud sandbox), Node needs: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle> node server.js`.

## Deploy (public URL)

The app is one Node process listening on `$PORT` (default 8080); `/healthz` is the health check.

- **Render:** New → Web Service → connect this repo → Runtime *Docker* → Root Directory `flight-tracker` → Create. Your link is `https://<name>.onrender.com`.
- **Fly.io:** `cd flight-tracker && fly launch --copy-config --name <unique-name> && fly deploy`.
- **Railway / any Docker host:** build `flight-tracker/Dockerfile` with `flight-tracker/` as the context.

Responses are cached for 1.5 s per map region, which keeps upstream load low, but the adsb.lol feed is community-run: review its terms before heavy or commercial public use.
