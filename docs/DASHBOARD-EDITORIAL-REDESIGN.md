# Dashboard/auth/editorial redesign — local verification

## Scope and baseline
Continued from local HEAD 350f6fbc46a4edb1672c438f54f2152bb4d94372. Preserved unrelated dirty work, including the language detector and its tests. No production queries/mutations, migrations, provider requests, ingestion, sends, commits, pushes or deployment in this task. All integration fixtures use a new PostgreSQL cluster bound to 127.0.0.1:54330 in ignored `.test-tools/dashboard/`.

## Audit and architectural decisions
The application is Next.js App Router with Prisma/PostgreSQL. Previously it used shared Basic Auth credentials, no users/sessions/roles, a combined approvals/reviews page, technical audit feeds, and Telegram-only publication. HumanEditorialDraft already preserved original failed AI state, versioned edits, revoked approval on edits, froze Publication content, and used a database advisory lock plus one-attempt claims. Reused those contracts.

WEB is now an explicit reserved Publication.destination value. Existing numeric Telegram destinations and their publisher remain separate. WEB publication atomically marks the frozen record SENT, records a PublicationAttempt and audit, and marks the associated human draft or AI news item published. It never invokes Telegram. The existing one-publication-per-news contract is preserved: this is not a new multi-channel broadcasting architecture. The WEB record is rendered on authenticated `/published`; no public reader/SEO site has been exposed. Public readership remains a product decision requested from the owner.

## Schema/migration
Prepared `202609190001_dashboard_editorial` (additive): DashboardUser, DashboardSession, LoginThrottle, PublicationImage; nullable publicationImageId fields on draft/publication and mediaDecisionAt on human draft. No source/evidence tables replaced. Migration applied and tested only on new local test database. Existing text-only approval digests remain unchanged when added media fields are null.

## Authentication and RBAC
Salted Node scrypt password hashes, 12–256-character passwords. Cryptographically random 256-bit session tokens; only SHA-256 token hashes stored server-side. Eight-hour expiry, HttpOnly/SameSite=Strict cookie and Secure in production. Database-backed per-account login throttle (10 attempts per 15 minutes), generic login failures. Accounts checked for enabled status at each authorization. User updates revoke all that user's sessions. Last enabled administrator cannot be disabled/demoted. Logout deletes the session server-side and cookie; pages use no-store and bfcache restores reload.

Proxy checks session and route permission. Mutating actions independently require session and appropriate role. Sensitive admin pages also enforce ADMIN server-side. EDITOR can access overview, approvals, reviews, published, and authorized story/media detail routes. ADMIN additionally manages sources, settings, users, logs, rejected/duplicate records and system status. No Basic Auth fallback in dashboard.

## UI and routes
Arabic-only brand منصة إيران الآن, Noto Sans Arabic through next/font/google, semantic light/dark CSS tokens and persistent theme, fixed right sidebar on desktop and keyboard/Escape-aware collapsible drawer on smaller screens. Shared NewsCard and centralized written status/tone mapping. No full status-color card backgrounds.

Navigation: نظرة عامة `/`; المصادر `/sources`; الموافقات `/approvals`; المراجعات `/review`; الأخبار المنشورة `/published`; المستبعد والمرفوض `/filtered`; الأخبار المكررة `/events`; سجل العمليات `/logs`; الإعدادات `/settings`; حالة النظام `/system`. Login `/login`, source review `/posts/[id]`, news review `/news/[id]`, authenticated media `/media/[id]`.

Overview is monitoring only. Approvals uses existing READY_TO_PUBLISH editorial eligibility or approved status, excludes source-media stories requiring a decision; operational shadow holds are not confused with factual failure. Reviews contains unresolved processing/grounding stories and human drafts; published/approved human versions do not continue appearing solely because original failed AI status remains preserved. Rejected, duplicate and published lists have no editorial links/actions. Rejection requires an explicit dialog/checkbox and preserves evidence/history; locked publications cannot be rejected.

## Human editing and media
Source first, original AI/errors available in disclosure, separate editable title/body, save, explicit responsibility attestation, frozen preview, separate publication confirmation. Saving changes including image decisions cancels pending unattempted approval; sent/claimed records stay immutable. Actor IDs resolve to user display names. Activity page selects user-attributed actions; historical technical logs remain in DB and operational state is shown under System.

TelegramReader now captures only hasMedia/hasPhoto metadata in its existing read results; no extra Telegram requests, media downloads, cursor, reconnect, or poll lifecycle changes. After successful normal text processing, source media adds an editorial attestation review reason. Existing historic posts lack these flags and are not retroactively backfilled. Source media remains a link to the original Telegram post, not copied into publication storage.

Optional publication images: user-selected PNG/JPEG, maximum 2 MiB, signature/MIME/structure/dimension checks (6000 per side, 16MP). No SVG, user paths, external URL fetching or AI generation. Small immutable bytes stored in PostgreSQL with generated IDs and digest; authenticated route serves fixed image MIME, nosniff and restrictive CSP. Preview/change/remove are available. Explicit no-image choice is valid; missing image is not a failure. Source-media drafts require a recorded human decision, not a nonempty image. Selection/removal and uploads are audited. Images are supported for WEB only; Telegram continues its established text-only behavior and rejects image-bearing drafts rather than silently dropping the image.

## Verification
- 39 tests passed in the combined dashboard auth/publication/UI/database, human editorial, Telegram publisher/monitor/recovery, production-quality and evidence-validation regression run. No failures/skips.
- Separate new source-media/text-processing integration test passed using deterministic fixture provider, no model transport.
- Separate local HTTP test passed: logged-out/forged sessions, valid/invalid login, ADMIN pages, EDITOR 403 boundaries, logout invalidation.
- Browser: local synthetic editor login; source/error display; edit/save; approve; frozen WEB preview; dark mode; desktop/mobile/tablet drawer. No browser send clicked. Image add/remove persistence was integration-tested; browser file-picker upload was not separately exercised.
- Scoped lint passed. Prisma validation passed; migration applied successfully locally.
- Isolated tracked-source production build/typecheck passed. Root worktree typecheck still reports only pre-existing untracked scripts/export-irannow.ts:100 TS2358; not altered. Isolated build excludes unrelated untracked scripts and copies current required source. No typecheck bypass flag.
- Diff whitespace check passed. Targeted secret-pattern scan passed; no credentials staged/committed. All .env/session/test output stays ignored.
- Google Fonts download was required for build; this is not a model/provider call. No new runtime package dependency.

## Deployment later, only after approval
1. Review task-only diff; do not include unrelated language/config/package/local work.
2. Back up DB and apply additive migration through the normal production migration process.
3. Bootstrap first ADMIN explicitly using `node --env-file=.env --import tsx scripts/bootstrap-dashboard-admin.ts`. This reads existing ADMIN_USERNAME/ADMIN_PASSWORD, requires a 12–256-character password, stores only hash, refuses if any user exists, prints no credentials. Do not run it against production before approval.
4. Deploy dashboard only after migration/admin readiness. Rollout worker metadata/review integration with the same schema. No publishing-mode change.
5. Verify login, role boundaries, protected media, local approval preview and existing historical publication state. No real send required for deployment verification.

Environment names: DATABASE_URL (DB); ADMIN_USERNAME and ADMIN_PASSWORD (explicit one-time bootstrap only); existing REQUIRE_APPROVAL, AUTO_PUBLISH, SHADOW_MODE remain unchanged. Existing TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_MANUAL_PUBLISH_ENABLED belong only to retained Telegram manual delivery; WEB needs none of them. NODE_ENV controls secure cookie. No session signing secret needed: opaque tokens are server-side revocable. No image storage credential/provider needed.

## Limits / review decisions
- No public article frontend was assumed; WEB currently means publication in the authenticated web dashboard. Confirm audience before public exposure.
- No backfill of old source-media metadata or source-image downloading.
- DB image storage is intentionally small/simple; growth should be monitored before choosing a separate object-storage service.
- Integration/browser tests use synthetic local fixtures, not production news. Legacy Basic-Auth HTTP test files are not an assertion about the new auth workflow; new dashboard HTTP regression exercises current sessions.
- Production migration, initial administrator, and production verification are intentionally pending approval. All changes remain local/uncommitted.

Safety: AI/provider calls 0; Telegram messages 0; production writes 0; production jobs requeued 0; AUTO_PUBLISH not enabled; SHADOW_MODE not disabled; secrets committed 0; deployments/pushes/commits 0.

## Task file inventory
- Schema: `prisma/schema.prisma`, `prisma/migrations/202609190001_dashboard_editorial/migration.sql`.
- Auth: `src/proxy.ts`, `src/lib/dashboard-auth.ts`, `src/lib/dashboard-permissions.ts`, `src/lib/session.ts`, `src/app/login/{page.tsx,actions.ts}`, `scripts/bootstrap-dashboard-admin.ts`.
- Routes: `src/app/{page.tsx,layout.tsx,globals.css,actions.ts}`, `src/app/{approvals,events,filtered,logs,published,review,settings,sources,system}/page.tsx`, `src/app/news/[id]/page.tsx`, `src/app/posts/[id]/page.tsx`, `src/app/settings/actions.ts`, `src/app/media/[id]/route.ts`.
- Components: `dashboard-shell.tsx`, `news-card.tsx`, `reject-story.tsx`, `user-form.tsx`, `forms.tsx`, `human-editor.tsx`, `human-editorial-panel.tsx`, `news-feed.tsx`, `post-feed.tsx`, `publication-send.tsx`, `ui.tsx` under `src/components/`.
- Services: `src/lib/{labels,human-editorial-contract,human-editorial,publication-media,web-publication}.ts`; small media/destination integrations in `src/lib/processing/engine.ts`, `src/lib/telegram/monitor.ts`, `src/lib/telegram/publisher.ts`; upload size in `next.config.ts`.
- New tests: `tests/dashboard-{auth,publication,database,http,media-processing}.test.ts`, `tests/dashboard-ui.test.tsx`.
- Documentation: this report. Ignored local fixture/build helpers are not deliverable source.

Exact test files run: the six new files above plus `tests/human-editorial.test.ts`, `tests/telegram-publisher.test.ts`, `tests/telegram.test.ts`, `tests/telegram-recovery.test.ts`, `tests/production-quality.test.ts`, and `tests/groq-validation.test.ts`: 41 distinct tests, 41 passed, 0 failed, 0 skipped. No full-suite claim.
