# Content Extraction App - v2

This version adds:
- SSRF protection and URL validation for /extract/url
- Authentication (JWT) and rate-limiting
- Frontend UX improvements: playback rate, voice selection, highlight current chunk, local caching of chunk->audio mapping
- Background worker using Bull + Redis for OCR jobs, with websocket progress events
- Polly TTS with fallback to google-tts-api when AWS creds not present
- Basic unit test placeholder and GitHub Actions CI
- Docker Compose including Redis
- Kubernetes manifests for backend and frontend (examples)

Quick start (docker-compose):
1. docker-compose up --build
2. Backend: http://localhost:3001
3. Frontend: http://localhost:3000

Notes:
- For production, replace simple login with proper user management and secure JWT secret.
- Ensure ALLOWED_HOSTS env var if you want to whitelist hostnames for URL extraction.

## Dev Ports Standardization
- Frontend (Vite dev): http://localhost:5174/
- Backend (Express): http://localhost:3001/
- Keep these ports consistent across environments; avoid changes that disrupt other features.
