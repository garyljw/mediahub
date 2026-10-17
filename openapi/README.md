# Pinned upstream OpenAPI specs

- Radarr v6.4.4.10685: https://raw.githubusercontent.com/Radarr/Radarr/v6.4.4.10685/src/Radarr.Api.V3/openapi.json (saved as `radarr.json`)
- Sonarr v4.0.20.3014: https://raw.githubusercontent.com/Sonarr/Sonarr/v4.0.20.3014/src/Sonarr.Api.V3/openapi.json (saved as `sonarr.json`)

To regenerate types after changing a spec: `npm run gen:arr` (writes `src/server/arr/generated/`). To upgrade, re-download the spec for the new tag here, then run the command.
