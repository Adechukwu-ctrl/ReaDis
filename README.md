# ReaDis

Production-ready setup for building, serving, and containerizing the app.

## Quick Start
- Dev: `npm install && npm run dev`
- Build: `npm run build`
- Prod server: `npm start` (Express serves `dist` on `3000`)
- Open: `http://localhost:3000/`

## Docker Hub Image
- Pull: `docker pull adechukwu/readis:latest`
- Run: `docker run -p 3000:3000 adechukwu/readis:latest`
- If `3000` is busy: `docker run -p 8080:3000 adechukwu/readis:latest`

## Compose (Production)
Use the published image with Compose:

```
docker compose -f docker-compose.prod.yml up -d
```

Stops:
```
docker compose -f docker-compose.prod.yml down
```

## GitHub Actions (Docker Hub)
Images automatically build and push on:
- Push to default branch `main` → tag `latest` + `sha-<short>`
- Push a tag `v*` (e.g., `v1.0.0`) → tag `v1.0.0` + `sha-<short>`

Secrets required in GitHub repo:
- `DOCKERHUB_USERNAME` = `adechukwu`
- `DOCKERHUB_TOKEN` = Docker Hub access token

Workflow file: `.github/workflows/dockerhub-publish.yml` (multi-arch: `linux/amd64`, `linux/arm64`).

## GitHub Actions (GHCR)
- GHCR workflow is manual (`workflow_dispatch`).
- Trigger from GitHub → Actions → “GHCR Publish” → “Run workflow”.

## Versioning
- Tag a release:
```
git tag -a v1.0.0 -m "release"
git push origin v1.0.0
```
- CI pushes `latest` on `main` and a tag matching your release.

## Troubleshooting
- Port conflicts: use `-p 8080:3000` or stop other apps on `3000`.
- Docker not running: start Docker Desktop.
- Image not found: ensure GitHub Actions completed and pushed to Docker Hub.
- Local build context too big: `.dockerignore` excludes `node_modules`, `.git`, and `dist`.

## Notes
- The container runs `node server.js` and serves `dist` over Express.
- SPA fallback uses catch-all middleware compatible with Express 5.
- Multi-arch manifests are produced via Buildx + QEMU.

## Release Workflow (one-click)
- Trigger: GitHub → Actions → “Release Tag” → “Run workflow”.
- Inputs:
  - bump: `patch` | `minor` | `major`
  - prefix: default `v` (keep `v` to trigger Docker Hub workflow)
  - prerelease: optional suffix (e.g., `-rc.1`)
- Result:
  - Updates `package.json` to the selected version and pushes commit.
  - Creates and pushes a new tag (e.g., `v1.0.1`).
  - The Docker Hub publish workflow builds and pushes multi-arch images.

