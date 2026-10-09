# Skywatch – live air traffic map

A FlightRadar24-style web app for airplanes **and helicopters**: live map, altitude-coloured rotated icons, trails,
search, filters (airplanes / helicopters / military / emergency squawks), and a detail panel with photo, route and telemetry.

    node server.js          # http://localhost:8080  (Node 18+, no dependencies)

Data comes from the open community feeds airplanes.live and adsb.lol (readsb/tar1090 v2 JSON, unfiltered like ADS-B Exchange),
with routes from adsbdb.com and photos from planespotters.net. If both feeds are unreachable the app shows an error and an empty map; it never fabricates traffic.
Check each provider's terms before any public or commercial deployment.
