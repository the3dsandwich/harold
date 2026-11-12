# Deployment storage

The deployment checkout is `~/01.github/harold/`. Set `APP_DATA_ROOT` in the ignored local `.env` to `~/00.system/services/harold` using an absolute path (not a literal tilde). Compose interpolates host paths from `.env`; persistent bind sources must exist. Application state is outside Git.

For configuration-only changes, run `docker compose config --quiet` then `docker compose up -d --no-build --pull never`. Stop the application before copying writable state; preserve ownership and permissions. Original data and configuration from this migration are retained privately under `~/00.system/.backups/2026-11-12-app-data-layout/`.
