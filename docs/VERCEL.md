# Vercel dashboard deployment

Deploy the existing Next.js app from `main` to project `iran-today` in the `promots` Hobby scope. No paid plan or add-on is required. `vercel.json` uses the existing `npm run build` so Prisma Client is generated on every build, including builds with cached dependencies.

Only these production environment variables are required, stored as Vercel secrets:

- `DATABASE_URL`: pooled Neon production connection.
- `ADMIN_USERNAME`: existing dashboard administrator.
- `ADMIN_PASSWORD`: existing dashboard password.

Use the values in the ignored local `.env` through secure stdin or the Vercel dashboard; never put values in shell arguments, source code or logs. `.vercel`, `.env*`, local Neon/MCP metadata, test tooling and build artifacts are excluded from Git and deployment uploads. `config/environment.example` is a names-only template.

All dashboard routes require the existing HTTP Basic authentication. Missing credentials fail closed; `/api/health` is intentionally a minimal public readiness endpoint. No Neon Auth SDK, schema changes or Phase 2 integrations are introduced.

The standalone heartbeat worker is not hosted by the Vercel dashboard. This deployment provides the web application only; no continuous worker or monitoring is activated.

Deployment command after checks and a clean pushed `main` checkout:

```sh
vercel deploy --prod --scope promots --yes
```

CLI deployment does not require automatic Git integration. During setup, Vercel could not connect the GitHub repository because the account needs a GitHub Login Connection. Automatic deployments on future pushes require that connection; the production CLI deployment uses the committed local `main` source.
