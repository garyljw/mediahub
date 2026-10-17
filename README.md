# MediaHub

One web UI for Radarr and Sonarr. Private, LAN-only, self-hosted on Synology.

## Dev setup
1. `brew install node gitleaks`
2. `npm install` (this also enables the secret-scanning git hook)
3. `cp .env.example .env.local` and fill in real values
4. `npm run dev` and open http://localhost:3000
