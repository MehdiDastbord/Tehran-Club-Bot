# V22 fixes

- Giveaway main panel no longer shows Prev/Next. Optional link is now a Link button.
- Drop text trigger is shown in the Drop message/embed.
- XP channel permission checks use safe channel permissions.
- Moderation access roles are separate for ban, kick, timeout and warn.
- Moderation actions now show actor and target publicly in the command response.
- Guess start posts a public start message in the same channel; secret remains DM-only.
- Welcome supports [user] placeholder and preserves it in saved configuration.
- Log embeds resolve user IDs to a mention-capable field plus avatar thumbnail.
- Exchange creation validates channel permissions and returns actionable errors instead of a generic internal error.
- Ticket claim leaderboard remains configured via /ticket leaderboard.
