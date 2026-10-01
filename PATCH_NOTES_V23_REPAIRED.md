# Tehran Club Bot V23 — Repaired Pass

## Applied fixes
- XP is server-wide: message XP no longer checks or requires a specific channel.
- Removed the XP `setchannel` slash command from command deployment.
- XP cooldown and DB persistence remain enabled.
- Removed manual Giveaway reroll command so winners are selected by the system at finalization.
- Ticket `remove` is restricted to the opener/owner of that ticket; Support remains responsible for support actions.
- Moderation permissions are independent; `unban` uses the Ban permission key.
- Exchange redesigned around `/exchange create` + Modal, with Banner URL persisted in DB.
- Exchange has separate Accept Channel, Main Channel and Exchange Role settings.
- Only Exchange Role can Accept/Reject, and duplicate decisions are blocked atomically.
- Accept validates Main Channel before changing state; failed delivery rolls the request back to pending.
- Exchange user text is mention-safe and outgoing Main Channel messages use `allowedMentions: {parse: []}`.
- Added `banner_url` DB migration for existing installations.
- Legacy Exchange configuration commands are no longer registered for deployment.

## Verification
- Node syntax checks: PASS
- Static check: PASS
- Production static audit: PASS
- Outbox SQL test: PASS
- Live Discord runtime test: NOT RUN (no live Discord credentials/environment available here)

## Voice/Music cleanup
- Replaced the old `/music` subcommand tree with `/play`, `/stop`, `/next`, `/leave`.
- Added `/afk` to join the invoker's current Voice Channel with self-mute/self-deaf and no audio player.
- Removed 24/7 music startup/health behavior and old music command routing.
- Music remains backed by discord-player extractors/FFmpeg for `/play`.


## AFK Lifecycle Hardening
- AFK voice connections now clear their active reference on `disconnected`/`destroyed` connection states.
- AFK voice errors are logged instead of silently swallowed.
- No automatic AFK reconnect is performed; `/afk` is required again after disconnect.
