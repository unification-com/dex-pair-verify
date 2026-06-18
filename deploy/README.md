# Deployment

Run dex-pair-verify on a single Linux host: the Next.js web server under systemd,
and the weekly data pipeline under cron.

Distro-agnostic — needs only `bash`, `systemd`, `cron` and `flock` (util-linux),
plus a user-space Node toolchain via [nvm](https://github.com/nvm-sh/nvm) and `yarn`,
and a reachable PostgreSQL. No distro packages and no hard-coded paths beyond two
lines you set in the unit file; the scripts auto-detect the repo location.

## Files

- `dex-pair-verify.env` — shared config (Node version, host, port, log root), sourced by the scripts.
- `nvm-init.sh` — shared nvm bootstrap (`nvm use "$NODE_VERSION"`); sourced by every script below.
- `run.sh` — starts the web server (`next start`); the systemd `ExecStart` target.
- `pipeline.sh` — runs `yarn pipeline`, logging to `$LOG_ROOT/YYYY-MM/`; the cron target.
- `beacon-writer.sh` / `fulfilment-watcher.sh` — start the two BEACON anchoring workers; systemd `ExecStart` targets.
- `dex-pair-verify.service` — systemd unit template for the web server.
- `dex-pair-verify-beacon-writer.service` / `dex-pair-verify-fulfilment-watcher.service` — units for the BEACON workers.
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

    0 3 * * 1 /bin/bash /path/to/dex-pair-verify/deploy/pipeline.sh

Runs every Monday at 03:00. Logs: `$LOG_ROOT/YYYY-MM/dex-pair-verify-YYYY-MM-DD.log`.
A `flock` guard skips a run if the previous one is still going.

## 6. BEACON anchoring workers (optional)

Two extra long-running processes anchor dpv's verified set to a Unification Mainchain
BEACON — separate from the web server. Skip this whole section if you're not anchoring.

- **`beacon-writer`** — holds a FUNDED `und` signing key; records the pair+token Merkle
  roots each minute and (with drip on) every leaf + OoO fulfilment receipt, one tx per
  block. Run **one** instance only (single account ⇒ serial nonce).
- **`fulfilment-watcher`** — read-only (no key); watches each OoO Router's
  `RequestFulfilled` event and queues receipts for the writer.

1. **Config.** Copy the `BEACON_*` / `OOO_ROUTER_*` block from `.env.example` into your
   `.env` and fill it in. Put the signer mnemonic in a file (not inline):

       sudo install -d -m 700 /etc/dpv
       printf '%s\n' "<24-word mnemonic>" | sudo tee /etc/dpv/beacon-writer.mnemonic >/dev/null
       sudo chown youruser /etc/dpv/beacon-writer.mnemonic && sudo chmod 600 /etc/dpv/beacon-writer.mnemonic

   `BEACON_DRIP_ENABLED=true` is **required** — without it only the root heartbeat runs and
   leaves / fulfilments / the re-anchor backlog never reach the chain.

2. **Schema.** `npx prisma db push` (from §2) creates the `BeaconChainState` table the
   writer needs — re-run it if you haven't since adding the workers.

3. **Register the beacon** (one-off; funds ~1000 FUND for the register fee):

       nvm use <NODE_VERSION>
       yarn beacon-writer register      # prints BEACON_ID=<n> — paste it into .env

4. **Install + enable** (set `User=` and the absolute `ExecStart=` path in each unit):

       sudo cp deploy/dex-pair-verify-beacon-writer.service /etc/systemd/system/
       sudo cp deploy/dex-pair-verify-fulfilment-watcher.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now dex-pair-verify-beacon-writer dex-pair-verify-fulfilment-watcher
       journalctl -u dex-pair-verify-beacon-writer -f      # watch it heartbeat + drip

The writer self-detects the vaxildan `x/beacon` upgrade (a `BeaconTimestampsByHash` probe):
before it, records carry no metadata; after, it switches over and re-anchors the backlog
WITH metadata automatically (`BEACON_REANCHOR_ENABLED`, default on). No restart needed.

## 7. Update / redeploy

    git pull
    nvm use <NODE_VERSION>
    yarn install --frozen-lockfile
    npx prisma generate
    yarn build
    sudo systemctl restart dex-pair-verify
    # if running the anchoring workers:
    sudo systemctl restart dex-pair-verify-beacon-writer dex-pair-verify-fulfilment-watcher

## Notes

- **Reverse proxy:** the server binds to loopback by default; terminate TLS and expose
  it with nginx, Caddy or similar.
- **Rootless alternative:** instead of a system unit, place the unit in
  `~/.config/systemd/user/`, run `systemctl --user enable --now dex-pair-verify`, and
  `loginctl enable-linger <user>` so it survives logout — no root required.
- **`status=203/EXEC`:** systemd couldn't execute the script. The unit and cron line
  launch the scripts via `/bin/bash …` precisely so this can't happen from a lost `+x`
  bit, a CRLF shebang, or an SELinux exec-label on a script under `/home`. If you invoke
  a script directly instead, ensure `chmod +x deploy/*.sh`, LF line-endings, and (under
  SELinux `Enforcing`) check `ausearch -m avc -ts recent` for an exec denial.
