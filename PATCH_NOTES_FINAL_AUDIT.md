# V23 Final Audit/Fix Pass

## Fixed in this pass
- XP remains server-wide; no XP channel restriction exists.
- Ticket panels are created with `/ticket addpanel`; legacy `/ticket panel` command was removed.
- Ticket panel menu is built from all saved panels, split only when Discord's select-menu limits require it.
- Music command surface is limited to `/play`, `/stop`, `/next`, `/leave` and `/afk`.
- Removed automatic 24/7 voice restoration on startup.
- Removed pause/resume/volume/loop/24-7 control paths from the Music service.
- `/afk` now replaces any existing music/AFK connection cleanly and uses self-mute/self-deaf.
- `/leave` also destroys an AFK-only voice connection.
- `/play` leaves AFK mode before starting music.
- `/exchange` is now the direct form command.
- Exchange settings are separate: `/exchange-accept-channel`, `/exchange-main-channel`, `/exchange-role`.
- Exchange output uses `allowedMentions: { parse: [] }`; user text is mention-stripped.
- Exchange accept remains atomic and rolls back to pending if the destination send fails.
- Exchange role must be manageable by the bot.

## Verification
- Node syntax checks: PASS
- Static checks: PASS
- Production static audit: PASS
- SQL outbox test: PASS
- Live Discord/runtime test: NOT AVAILABLE in this environment
