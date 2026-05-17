# Orbit

Healthcare scheduling app with constraint-based scheduling and Microsoft Outlook sync.

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind + ShadCN
- **Backend:** Node + Express + TypeScript + Prisma
- **Scheduler:** Python + FastAPI + Google OR-Tools
- **Database:** Supabase Postgres (free tier)

## Workspaces

- `backend/` — Express API + Prisma (npm workspace)
- `frontend/` — React admin UI (npm workspace)
- `scheduler/` — Python OR-Tools microservice (uv-managed, not part of npm workspaces)

## Initial setup

1. Copy `.env.example` to `.env` and fill in your Supabase connection strings.
2. From the repo root: `npm install` (installs backend + frontend workspaces).
3. Run the first migration: `npm run db:migrate`.
4. (Scheduler) `cd scheduler && uv sync`.

## Daily dev

Run each service in its own terminal:

```powershell
npm run dev:backend     # Express on :4000
npm run dev:frontend    # Vite on :5173
cd scheduler; uv run uvicorn app.main:app --reload --port 8000
```

Database inspection: `npm run db:studio` opens Prisma Studio in the browser.

## Phase status

Currently in **Phase 1** (foundation). See `C:\Users\eshlo\.claude\plans\healthcare-scheduling-application-radiant-puddle.md` for the full plan.
