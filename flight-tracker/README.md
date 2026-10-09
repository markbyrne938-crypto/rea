# Skywatch – live air traffic map

A FlightRadar24-style web app for airplanes **and helicopters**: live map, altitude-coloured rotated icons, trails,
search, filters (airplanes / helicopters / military / emergency squawks), and a detail panel with photo, route and telemetry.

    node server.js          # http://localhost:8080  (Node 18+, no dependencies)
    DEMO=1 node server.js   # simulated traffic, for offline UI work

Data comes from the open community feeds airplanes.live and adsb.lol (readsb/tar1090 v2 JSON, unfiltered like ADS-B Exchange),
with routes from adsbdb.com and photos from planespotters.net. If both feeds fail, the server serves clearly badged simulated traffic.
Check each provider's terms before any public or commercial deployment.
