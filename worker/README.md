# Marketing Agent — Playwright Worker

Independent Node.js service that processes video generation jobs from BullMQ queue.

## Setup

1. Install dependencies:
   ```bash
   npm install
   npx playwright install chromium
   ```

2. Generate Prisma client (pointing to the root schema):
   ```bash
   npm run prisma:generate
   ```

3. Create `.env` from `.env.example` and fill in DATABASE_URL and REDIS_URL

4. First-time 即梦 login (one-time setup):
   ```bash
   npm run first-login
   ```
   A browser will open — log in to jimeng.jianying.com manually, then press Ctrl+C.
   The session is saved to `.jimeng-session/` and reused on subsequent runs.

5. Start the worker:
   ```bash
   npm start
   ```

## Notes

- The `.jimeng-session/` directory stores browser cookies/localStorage. Keep this private.
- If 即梦 logs you out mid-batch, re-run `npm run first-login`.
- Concurrency is controlled by `CONCURRENCY` env var (default: 3).
- Worker must run on a machine with a GUI (headless: false required for 即梦).
- Prisma client is generated separately in this directory using `npm run prisma:generate`, which references the root `prisma/schema.prisma`.
