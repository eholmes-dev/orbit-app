# Orbit

Healthcare scheduling app with constraint-based scheduling and Microsoft Outlook sync.

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fcdn.jsdelivr.net%2Fgh%2Feholmes-dev%2Forbit-app%40main%2Finfra%2Fmain.json/createUIDefinitionUri/https%3A%2F%2Fcdn.jsdelivr.net%2Fgh%2Feholmes-dev%2Forbit-app%40main%2Finfra%2FcreateUiDefinition.json)

## Install options

Pick one — both end up with the same app, just different hosting:

| | **Azure (BYOC)** | **Self-hosted Docker** |
|---|---|---|
| Where it runs | Your Azure subscription | A machine you control |
| Client install | Nothing | Docker Desktop |
| Setup time | ~20 min in the portal | ~30 min on the machine |
| Cost | ~$15–25/month in Azure | Hardware you already own |
| TLS | Automatic | DIY (or HTTP on internal network) |
| Updates | Re-run deploy | `docker compose pull && up -d` |

### Option 1: Deploy to Azure (recommended)

Click the **Deploy to Azure** button above. You'll need:

1. An Azure subscription with permission to provision a resource group.
2. An **Entra app registration** — see the [walkthrough below](#entra-app-registration).

The portal opens a 2-step wizard asking for an admin email and your Entra app registration's tenant ID + client ID + client secret. ~10 minutes from "click" to "open in browser."

**Optional network restriction:** The wizard also accepts a comma-separated list of CIDR ranges that are allowed to reach the app (e.g. `203.0.113.0/24, 198.51.100.42/32`). Anyone outside those ranges gets a 403 at the ingress — before they ever see the sign-in page. Leave the field blank to keep the app public (sign-in is still required either way). This is the simplest way to scope the deployment to your office / VPN network without buying into a full intranet VNet story.

After deploy, copy the `redirectUri` output into your Entra app registration's **Authentication → Web → Redirect URIs**, then open `appUrl` in a browser.

### Option 2: Self-hosted Docker

```powershell
# Clone, copy env, fill in Microsoft + session secret values
git clone https://github.com/eholmes-dev/orbit-app.git
cd orbit-app
cp .env.example .env  # then edit .env

# Bring up the bundled stack
npm run docker:up

# Tail logs (optional)
npm run docker:logs

# Open the app
start http://localhost:4000
```

The Docker stack bundles Postgres in a container — no Supabase / external DB needed. See `.env.example` for what each variable does.

---

## Entra app registration

Required for both install paths. ~5 minutes in the Azure portal:

1. Sign into [https://entra.microsoft.com](https://entra.microsoft.com).
2. **Identity → Applications → App registrations → New registration.**
3. Name it `Orbit`, leave the rest at defaults, **Register.**
4. From the Overview page, copy:
   - **Application (client) ID**
   - **Directory (tenant) ID**
5. **Certificates & secrets → New client secret.** Pick a 12-month expiry. **Copy the VALUE column** (not the Secret ID — that's the wrong one). You only get to see it once.
6. **API permissions → Add a permission → Microsoft Graph → Delegated permissions.** Add: `User.Read`, `Calendars.ReadWrite`. Grant admin consent for the tenant.
7. **Authentication → Add a platform → Web.** You'll add the redirect URI here AFTER the deploy gives you a stable hostname (the Azure path) or use `http://localhost:4000/api/auth/callback` (Docker path).

The three values from steps 4–5 are what the Deploy to Azure wizard asks for.

---

## Pausing or tearing down an Azure deployment

The deploy provisions a Postgres Flexible Server that bills continuously (~$13/mo) regardless of traffic. Three options for when you don't need the deployment running:

### Pause — keep data + config (~$3/month)

Best when you'll come back to *this* deployment with its data.

1. Azure portal → your resource group → **Postgres server** (`orbit-pg-xxxxxx`) → **Stop** in the top toolbar.
2. *(Optional)* `orbit-backend` Container App → **Scale** in the left sidebar → **Min replicas: 0** → Save.

Cost while paused: ~$3/month (Postgres storage only).

**To resume:** **Start** the Postgres server (~2 min), and bump backend min replicas back to 1 if you changed it. Data, Entra wiring, Key Vault secrets — all preserved.

> ⚠️ **Azure auto-restarts stopped Postgres servers after 7 days.** If you leave it paused longer than a week, re-stop it (or it'll quietly start billing the compute hours again).

### Full teardown — $0 (fastest if you're done)

Best when you're done with this deployment and OK losing data. Bicep is in git, so redeploying is one click of the Deploy to Azure button.

1. Azure portal → **Resource groups** → click your RG → **Delete resource group** → type the name to confirm.

Takes ~3 minutes. Every resource (Postgres, Container Apps, Key Vault, Log Analytics, secrets) is gone.

> ⚠️ **Key Vault soft-delete (7 days).** The Bicep sets `softDeleteRetentionInDays: 7`, so the vault sits in a soft-delete state for a week after RG deletion. If you redeploy with the same `namePrefix` within 7 days, you'll hit "vault already exists." Fix: use a different prefix, or purge the deleted vault (portal → **Key vaults** → **Manage deleted vaults** → select → **Purge**).

### Cost-alert safety net (recommended before any test deploy)

Azure portal → **Cost Management** → **Budgets** → **Add** → scope to your resource group, set ~$10/month with an email alert at 50%. Takes a minute, costs nothing.

---

## Development workflow

For day-to-day development against Supabase (the project's current dev setup):

```powershell
# One-time setup
npm install
cd scheduler; uv sync; cd ..

# Run each service in its own terminal
npm run dev:backend     # Express + tsx on :4000
npm run dev:frontend    # Vite on :5173
cd scheduler; uv run uvicorn app.main:app --reload --port 8000
```

`.env` should have both `DATABASE_URL` (pooled Supabase URL with `?pgbouncer=true`) and `DIRECT_URL` (direct port 5432) set. Database inspection: `npm run db:studio`.

To switch dev over to bundled Docker Postgres instead of Supabase, see Mode 2 in `.env.example`.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  orbit-backend  (Express + bundled frontend)    │
│  - serves /api/*  (auth, schedule, events, ...) │
│  - serves /  (the React app)                    │
└──────────────┬─────────────────┬────────────────┘
               │                 │
               ▼                 ▼
┌─────────────────────┐  ┌─────────────────────────┐
│  orbit-scheduler    │  │  postgres               │
│  Python + OR-Tools  │  │  16-alpine (Docker) or  │
│  CP-SAT solver      │  │  Flexible Server (Azure)│
└─────────────────────┘  └─────────────────────────┘
```

## Workspaces

- `backend/` — Express API + Prisma (npm workspace)
- `frontend/` — React admin UI (npm workspace)
- `scheduler/` — Python OR-Tools microservice (uv, separate)
- `infra/` — Bicep template + portal UI definition for Azure deploy

## License

Private. All rights reserved.
