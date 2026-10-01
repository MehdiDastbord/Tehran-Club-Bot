# V21 Patch Notes

- Fixed XP channel permission check: never call `permissionsFor` on `GuildMember`.
- Added a safe channel permission helper.
- Removed the need for `/ticket addtype`.
- `/ticket panel` now creates up to 5 buttons directly.
- Each Ticket button supports label, emoji, key and welcome message.
- Added `/panel` as a short alias for Ticket Panel creation.
- Added `/menu`, a central dropdown control panel for all major systems.
- Ticket creation now sends a dedicated welcome embed before the control embed.
- Ticket creation checks Manage Channels + Manage Roles.
- Existing ticket types remain backward compatible.
