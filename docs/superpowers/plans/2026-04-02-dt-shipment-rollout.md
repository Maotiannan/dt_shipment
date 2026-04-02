# DT Shipment Production Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `dt_shipment` 在 Docker Mac 上以生产方式运行，数据持久化到 NAS，并通过 `ship.dainty.vip` 暴露，同时清理旧 `xianyu` 遗留。

**Architecture:** 使用三服务架构（PostgreSQL、后端、前端）。前端作为对外唯一入口，通过同源 `/api` 访问后端；前端加入 `dainty_net` 供现有 `cloudflared` 访问。版本元数据统一收口到仓库单一来源文件，并由前后端共同消费。

**Tech Stack:** Docker Compose, PostgreSQL 16, Node.js, Express 5, React 19, Vite, Cloudflare Tunnel, SMB NAS

---

### Task 1: Stabilize Repository Layout

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.dockerignore`
- Modify: `backend/package.json`
- Modify: `frontend/package.json`
- Remove from VCS: `backend/node_modules/`
- Remove from VCS: `backend/dist/`
- Remove from VCS: `frontend/dev-dist/`

- [ ] Step 1: add root metadata file to become the single version source
- [ ] Step 2: add ignore rules so dependencies and build artifacts stay out of git and Docker context
- [ ] Step 3: update app package manifests to expose test/build scripts cleanly
- [ ] Step 4: remove committed runtime/build artifacts from the repository
- [ ] Step 5: verify `git status` only shows intentional source/config changes

### Task 2: Add Test-first Config and Version Behavior

**Files:**
- Create: `backend/src/**/*.test.ts`
- Create: `backend/src/appMeta.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/db.ts` (only if needed for app config isolation)

- [ ] Step 1: write failing backend tests for shared app metadata loading and public meta endpoint behavior
- [ ] Step 2: run backend test command and confirm failures are due to missing implementation
- [ ] Step 3: implement minimal shared metadata loader and `/api/meta`
- [ ] Step 4: rerun backend tests until green
- [ ] Step 5: keep `/api/health` compatible with runtime smoke checks

### Task 3: Add Frontend Runtime Metadata and Same-origin API Production Mode

**Files:**
- Create: `frontend/src/lib/appMeta.ts`
- Create: `frontend/src/**/*.test.tsx` (if needed for UI assertions)
- Modify: `frontend/src/lib/apiClient.ts`
- Modify: `frontend/src/components/TopBar.tsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/vite.config.ts`

- [ ] Step 1: write failing test or minimal assertion path for version display and production API base behavior
- [ ] Step 2: update frontend to read version from the shared source at build time
- [ ] Step 3: render version in the top bar without disturbing current layout
- [ ] Step 4: make production builds target same-origin `/api`, while preserving local dev override support
- [ ] Step 5: verify frontend build succeeds

### Task 4: Production Dockerization

**Files:**
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `frontend/nginx.conf` (or equivalent static server config)
- Create: `compose.production.yml` (or replace root compose with production-safe layout)
- Create: `scripts/*.sh` for init/smoke if needed
- Modify: `backend/.env.example`
- Modify: `frontend/.env.example`

- [ ] Step 1: define backend production image with build and runtime stages
- [ ] Step 2: define frontend production image that serves static assets and proxies `/api`
- [ ] Step 3: define compose services, networks, host paths, health checks, and restart policy
- [ ] Step 4: ensure PostgreSQL data path resolves to `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment/postgres`
- [ ] Step 5: validate compose syntax with `docker compose config`

### Task 5: Local Infrastructure Cleanup

**Files:**
- Delete: `/Users/maotiannan/dev/docker/compose/xianyu.yml`
- Delete: `/Users/maotiannan/dev/docker/compose/scripts/update-xianyu.sh`
- Modify: `/Users/maotiannan/dev/docker/migration/cloudflared-guard.sh`

- [ ] Step 1: confirm no running `xianyu` container remains
- [ ] Step 2: delete only the local `xianyu` compose/script sources
- [ ] Step 3: remove `xianyu.dainty.vip` from local tunnel watchdog probe list
- [ ] Step 4: add `ship.dainty.vip` to local probe list
- [ ] Step 5: verify no unrelated compose files or services changed

### Task 6: Deploy and Verify Locally

**Files:**
- Modify only generated runtime env files under NAS root if needed

- [ ] Step 1: prepare NAS directory tree under `/Volumes/团队文件-DAINTY_SHIPMENT/docker/dt_shipment`
- [ ] Step 2: build and start the stack with Docker Compose
- [ ] Step 3: initialize the database if startup flow does not auto-init
- [ ] Step 4: run API-first smoke checks against local container endpoints
- [ ] Step 5: verify container health, NAS mounts, and persisted files

### Task 7: Switch Cloudflare Hostname

**Files:**
- No repo file required if dashboard-only change

- [ ] Step 1: open Cloudflare Zero Trust tunnel public hostname settings in browser automation
- [ ] Step 2: remove or disable the stale `xianyu.dainty.vip -> xianyu-auto-reply-fixed` binding
- [ ] Step 3: add `ship.dainty.vip -> http://dt-shipment-frontend:80`
- [ ] Step 4: wait for tunnel config refresh in `cloudflared` logs
- [ ] Step 5: verify public access by `curl https://ship.dainty.vip` and ensure `xianyu` errors stop appearing

### Task 8: Update README and Publish

**Files:**
- Modify: `README.md`

- [ ] Step 1: rewrite README to match the actual Docker/NAS/Cloudflare deployment
- [ ] Step 2: include startup, upgrade, backup, verification, and troubleshooting commands
- [ ] Step 3: run fresh verification commands for tests, build, compose, and smoke checks
- [ ] Step 4: review final diff for only intentional changes
- [ ] Step 5: commit and push to `main` (or current working branch if policy changes)
