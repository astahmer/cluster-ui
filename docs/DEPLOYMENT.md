# cluster-ui deployment guide

This guide deploys cluster-ui as a read-only operations dashboard. The
production process serves the built React application and the Effect HTTP API
from one Node process.

## Deployment model

```text
browser ── HTTPS ── reverse proxy ── cluster-ui :8787
                                      ├─ PostgreSQL (Effect Cluster)
                                      ├─ SQLite (optional)
                                      └─ Redis/BullMQ (optional)
```

The dashboard reads cluster storage directly. It does not need to run beside
the cluster workers, but it must be able to reach the configured database or
Redis endpoint.

For a production installation:

- run `pnpm build` during the release step;
- install or copy the resulting package, including `bin/`, `server/dist/`, and
  `dist/`;
- run `cluster-ui <target>` as a long-lived service from the workspace whose
  relative data paths should be used;
- bind the process to a private interface and put TLS/authentication at the
  reverse proxy or network boundary;
- set `CLUSTER_UI_READONLY=1` unless operators explicitly need dashboard
  write actions;
- use a database role that has only the permissions the dashboard needs.

## Prerequisites

- Node.js and pnpm versions compatible with the repository lockfile;
- network access from the deployment host to the cluster storage;
- a persistent location for `CLUSTER_UI_STATE_FILE` if alerts/audit state must
  survive restarts;
- an HTTPS reverse proxy if the dashboard is reachable beyond localhost.

Effect v4 packages are installed from npm (the `rc` dist-tag) like any other
dependency — no sibling monorepo checkout is required. `pnpm install` followed
by `pnpm build` works from a plain packaged artifact. Do not copy only
`dist/`: the server bundle (`server/dist/main.cjs`) and its runtime
dependencies are still required.

## Build and verify a release

Run this from the cluster-ui checkout:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run e2e
```

The build writes the frontend to `dist/`. The server falls back to API-only
operation if that directory is absent, so treat a missing `dist/index.html` as
a release failure for a dashboard deployment.

## Configure the cluster connection

Create an environment file outside the repository, for example
`/etc/cluster-ui/cluster-ui.env`:

```sh
HOST=127.0.0.1
PORT=8787

# PostgreSQL-backed Effect Cluster.
CLUSTER_UI_CLUSTERS=emisoup=postgres://cluster_ui_reader:REDACTED@db.internal:5432/emisoup
CLUSTER_UI_READONLY=1

# Protect /api/* even when the reverse proxy is accidentally exposed.
CLUSTER_UI_TOKEN=REDACTED

# Persist alert and audit state outside the release directory.
CLUSTER_UI_STATE_FILE=/var/lib/cluster-ui/state.json
```

Supported registry entries use this form:

```sh
CLUSTER_UI_CLUSTERS='name=spec,name2=spec2'
```

`spec` can be:

```sh
# PostgreSQL / Effect Cluster storage
emisoup=postgres://user:password@host:5432/database

# SQLite storage; the optional suffix overrides the table prefix
local=/var/lib/emisoup/cluster.db:cluster

# Redis/BullMQ queues
jobs=rediss://:password@redis.internal:6380
```

Use URL encoding for reserved characters in database and Redis credentials.
Keep the environment file readable only by the service account. Never commit
it or put credentials in the README, unit file, proxy configuration, or shell
history.

### PostgreSQL permissions

Create a dedicated read-only role for cluster-ui and grant it access to the
schema and cluster storage tables. The exact table prefix must match the
application’s `SqlShardStorage` and `SqlMessageStorage` configuration. A
typical starting point is:

```sql
CREATE ROLE cluster_ui_reader LOGIN PASSWORD 'use-a-secret-manager';
GRANT CONNECT ON DATABASE emisoup TO cluster_ui_reader;
GRANT USAGE ON SCHEMA public TO cluster_ui_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cluster_ui_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO cluster_ui_reader;
```

Review the resulting grants with your database administrator. `SELECT` is
enough for the read-only dashboard; do not grant `INSERT`, `UPDATE`, `DELETE`,
or schema-management privileges to this role.

## Run it as a service

Example systemd unit; adjust paths, the service user, and the pnpm executable
for the host:

```ini
[Unit]
Description=cluster-ui Effect Cluster dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=cluster-ui
Group=cluster-ui
WorkingDirectory=/opt/cluster-ui
EnvironmentFile=/etc/cluster-ui/cluster-ui.env
ExecStart=/usr/local/bin/cluster-ui
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/cluster-ui

[Install]
WantedBy=multi-user.target
```

Enable it after the release has passed verification:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now cluster-ui
sudo systemctl status cluster-ui
```

Use `journalctl -u cluster-ui -f` for startup and connection errors. A
successful process start does not prove that every configured cluster is
reachable; verify each cluster in the UI and confirm that its data surfaces
load successfully.

## Reverse proxy and HTTPS

Keep cluster-ui on a private listener and proxy it through HTTPS. The trace
detail page uses Server-Sent Events, so the proxy must allow long-lived
streaming responses and disable buffering for `/api/*`.

Example nginx location:

```nginx
server {
    listen 443 ssl;
    server_name cluster-ui.example.internal;

    # Configure certificates, HSTS, and your organization's access policy here.

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

The application token is a second boundary, not a replacement for TLS or
network access control. If `CLUSTER_UI_TOKEN` is set, `/healthz` remains
available for liveness checks while `/api/*` requires the token through the
`Authorization: Bearer` header or the login flow.

## Health checks and smoke checks

From the deployment host:

```sh
curl --fail http://127.0.0.1:8787/healthz
curl --fail -H 'Authorization: Bearer REDACTED' \
  http://127.0.0.1:8787/api/config
```

Then verify:

1. the browser loads the dashboard through the public HTTPS URL;
2. `/api/config` lists the expected cluster names and read-only state;
3. Overview, Messages, Traces, and the relevant Queues/Workflows surfaces
   contain current data;
4. opening a trace receives live updates or clearly falls back to polling;
5. a failed-message detail is visible but write actions are disabled in a
   read-only deployment;
6. the reverse proxy keeps an EventSource trace request open instead of
   returning a buffered or prematurely closed response.

## SQLite and Redis notes

For SQLite, set either `CLUSTER_UI_DB` for a single default cluster or use a
SQLite entry in `CLUSTER_UI_CLUSTERS`. Keep the database file, its WAL/SHM
files, and `CLUSTER_UI_STATE_FILE` on persistent storage. If the cluster is
actively writing, mount the whole SQLite directory rather than copying only
the main `.db` file.

For Redis/BullMQ, use `redis://` or `rediss://` entries. Redis-backed surfaces
provide queue/job views; SQL-only surfaces such as Effect Cluster traces and
workflow storage are not populated by Redis entries. Configure a separate
registry entry when one dashboard needs both SQL and Redis views.

## Upgrades and rollback

1. Build and verify the new release in a separate checkout or release
   directory.
2. Keep the environment file and persistent state directory outside the
   release directory.
3. Stop or restart the service only after `pnpm run build` and the smoke/API
   checks pass.
4. Confirm `/healthz`, `/api/config`, and one representative data page after
   the restart.
5. Roll back by pointing the service at the previous verified checkout and
   restarting it; do not roll back by deleting the shared state or database.

There are no cluster-ui database migrations: it reads the storage schema owned
by the Effect Cluster/application deployment. Upgrade cluster-ui and the
cluster storage implementation in a coordinated change when their table
contracts change.

## Local Emisoup deployment

With the local Emisoup PostgreSQL container exposed on port `5438`:

```sh
cd ~/dev/cluster-ui
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
CLUSTER_UI_TARGET='postgres://user:password@127.0.0.1:5438/db_dev' \
CLUSTER_UI_READONLY=1 \
cluster-ui
```

Open <http://localhost:8787>. Stop it with `Ctrl-C`. For iterative local
development, use `pnpm dev` as described in the root README; it runs Vite on
port `5173` and proxies API requests to the server on `8787`.
