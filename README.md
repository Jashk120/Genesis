# Genesis — backend

Local-first Notion-like writing app. Rust backend (Axum + Postgres), React frontend in `client/` (owned by another agent).

## Prerequisites

- Rust 1.98+ (`cargo --version`)
- Docker (daemon running) for Postgres
- `sqlx-cli`: `cargo install sqlx-cli --no-default-features --features postgres`

## 1. Start the database

```sh
cp .env.example .env
docker compose up -d
```

## 2. Run migrations

```sh
sqlx database setup
# or, equivalently:
# sqlx migrate run --source crates/store/migrations
```

`DATABASE_URL` must be set (see `.env.example`).

## 3. Run the server

```sh
cargo run -p server
```

Listens on `127.0.0.1:8080` (`BIND_ADDR` overrides). Serves the React SPA from
`client/dist` (`CLIENT_DIST` overrides) with SPA fallback to `index.html`;
if `client/dist` is missing the server still starts and `/api/*` keeps working.

## 4. Build the client

Owned by the frontend agent:

```sh
cd client && pnpm install && pnpm build
```

In dev, Vite proxies `/api` to `http://127.0.0.1:8080`.

## API

- `GET /api/health` → `{"status":"ok"}`
- `GET /api/workspaces`
- `GET /api/pages?workspace_id=&parent_id=` · `POST /api/pages`
- `PATCH /api/pages/:id` · `DELETE /api/pages/:id`
- `GET /api/pages/:id/blocks` (canonical `{type,data,children}` tree)
- `PUT /api/pages/:id/blocks` (same shape; flattened to rows, ids preserved)

## Checks

```sh
cargo fmt
cargo build --workspace
cargo test --workspace
```
