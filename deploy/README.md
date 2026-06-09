# Deployment

Run dex-pair-verify on a single Linux host: the Next.js web server under systemd,
and the weekly data pipeline under cron.

Distro-agnostic — needs only `bash`, `systemd`, `cron` and `flock` (util-linux),
plus a user-space Node toolchain via [nvm](https://github.com/nvm-sh/nvm) and `yarn`,
and a reachable PostgreSQL. No distro packages and no hard-coded paths beyond two
lines you set in the unit file; the scripts auto-detect the repo location.

## Files

- `dex-pair-verify.env` — shared config (Node version, host, port, log root), sourced by the scripts.
- `run.sh` — starts the web server (`next start`); the systemd `ExecStart` target.
- `pipeline.sh` — runs `yarn pipeline`, logging to `$LOG_ROOT/YYYY-MM/`; the cron target.
- `dex-pair-verify.service` — systemd unit template for the web server.
- `crontab.example` — the weekly cron line.

## 1. Configure

Edit `dex-pair-verify.env` if the defaults don't suit:

- `NODE_VERSION` — nvm Node version to run (`nvm use <this>`). Default `v20.19`.
- `HOST` / `PORT` — bind interface and port. Default `127.0.0.1:6973` (loopback).
- `LOG_ROOT` — base dir for pipeline logs. Default `$HOME/logs`.

## 2. Database

The schema is at the repo root (`schema.prisma`, PostgreSQL). Set `POSTGRES_PRISMA_URL`
in `.env`, then apply it (there are no migration files — the project uses `db push`):

    npx prisma db push

To reset data: `yarn dump truncate-dex` (keeps auth/login) or `yarn dump truncate-all`.

## 3. Build

As the app user, from the repo root:

    nvm use <NODE_VERSION>
    yarn install --frozen-lockfile
    npx prisma generate
    yarn build

## 4. Web service (systemd)

1. In `dex-pair-verify.service` set `User=` and the absolute `ExecStart=` path to your
   checkout's `deploy/run.sh`.
2. Install and start:

       sudo cp deploy/dex-pair-verify.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now dex-pair-verify

3. Verify:

       systemctl status dex-pair-verify
       ss -ltnp | grep "$PORT"      # should show 127.0.0.1:PORT, not 0.0.0.0
       journalctl -u dex-pair-verify -f

`run.sh` `exec`s Node, so systemd supervises the server process directly — `systemctl
stop` sends `SIGINT` straight to Next.js for a clean shutdown.

## 5. Weekly pipeline (cron)

As the app user (`crontab -e`), add the line from `crontab.example`, pointing at your
checkout:

    0 3 * * 1 /path/to/dex-pair-verify/deploy/pipeline.sh

Runs every Monday at 03:00. Logs: `$LOG_ROOT/YYYY-MM/dex-pair-verify-YYYY-MM-DD.log`.
A `flock` guard skips a run if the previous one is still going.

## 6. Update / redeploy

    git pull
    nvm use <NODE_VERSION>
    yarn install --frozen-lockfile
    npx prisma generate
    yarn build
    sudo systemctl restart dex-pair-verify

## Notes

- **Reverse proxy:** the server binds to loopback by default; terminate TLS and expose
  it with nginx, Caddy or similar.
- **Rootless alternative:** instead of a system unit, place the unit in
  `~/.config/systemd/user/`, run `systemctl --user enable --now dex-pair-verify`, and
  `loginctl enable-linger <user>` so it survives logout — no root required.
