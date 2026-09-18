# Tehran Club Bot — Supabase / Railway

This version uses **Supabase PostgreSQL** instead of the local SQLite database.

## Railway variables

Add these variables to the Railway service:

```text
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
GUILD_ID=your_discord_server_id
DATABASE_URL=your_supabase_session_pooler_connection_string
```

Do not commit or share your Discord token, database password, or DATABASE_URL.

## Supabase setup

1. Create a Supabase project.
2. Open **Connect** in the Supabase dashboard.
3. Select the **Session Pooler** connection string for PostgreSQL.
4. Copy the connection string and replace its password with your database password.
5. Put the complete connection string in Railway as `DATABASE_URL`.

You do **not** need to manually create the bot tables. The bot creates its required PostgreSQL tables automatically when it starts.

## Railway start

```text
npm start
```

Slash commands can still be registered with:

```text
npm run register
```

If you want Railway to register commands before starting the bot, use:

```text
npm run register && npm start
```

## Important

The old `tehran_club.sqlite` file is no longer used by this version. Existing SQLite data is not automatically imported. Keep your old ZIP/database as a backup until you have confirmed the new Supabase database is working.

## Persistent data stored

The bot creates tables for guild configuration, warnings, XP/levels, level roles, staff members/claims, exchange requests, giveaways/entries, and invite data.
