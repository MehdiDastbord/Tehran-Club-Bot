# Tehran Club Bot V20 - Final Fixes

This build keeps the requested Ticket Claim behavior unchanged.

## Fixes in this build
- Fixed Ticket feedback buttons in DMs (DM interactions have no guild context).
- Fixed duplicate Ticket transcript defer/reply flow.
- Added close-reason modal to the Ticket Close button.
- Added validation for Ticket feedback rating (1-5) and single-use feedback.
- Music commands now consistently require the configured Music access role/admin/owner.
- Welcome channel setup validates Bot permissions.
- AI channel setup validates Bot permissions.
- Custom command responses are capped to Discord-safe message length.
- Delivery queue Edit actions now supersede a completed edit with the same logical dedupe key.
- Delivery and role-sync outboxes now stop retrying after 10 failed attempts and mark the item failed.
- Manual retry resets attempt counters.

## Verification
- Node syntax checks: PASS
- Static checks: PASS
- Production static audit: PASS
- Outbox SQL test: PASS

Live Discord API tests and dependency installation require the deployment/VPS environment.

- Ticket Claim Leaderboard is now cumulative across all recorded claims instead of a rolling 6-hour window.
- The leaderboard updates one persistent Embed message every 6 hours; it does not create a new message each cycle.
- The last leaderboard update time is persisted so a bot restart does not reset the 6-hour cadence.
- Added a database migration that backfills historical `tickets.claimed_by` records into `ticket_claim_events` when older V20 databases are upgraded.
- Staff List remains DB-based and `/staff add` continues to populate the Staff database list as requested.

## V20 final command completion
- Added `/setticketlog` to configure all log channels in one command.
- Added `/setex` for the approved Exchange output channel; accepted requests are copied there.
- Added `/banch` with the configured Banch access role and target role IDs, including Manage Roles/hierarchy checks.
- Added `/embed` for Owner: 1-25 buttons per message, supporting 10+ buttons; each button has its own private/ephemeral response. Button definitions persist in SQLite.
- Added `/rerole` for Owner: rerolls the latest ended giveaway in the current channel and excludes the previous winner.
