# Tehran Club Bot — New Ticket System

## 1. Supabase migration

Run `ticket_system_migration.sql` once in the Supabase SQL Editor.

It adds panel numbering/types, transcript storage, a unique giveaway-entry index, and removes only the legacy staff-management tables/settings.

## 2. Railway variables

Use:

```env
OWNER_IDS=YOUR_ID,SECOND_ID
```

or the new name:

```env
AUTHORIZED_IDS=YOUR_ID,SECOND_ID
```

`AUTHORIZED_IDS` takes priority. `OWNER_IDS` and `OWNER_ID` remain compatible.

## 3. Ticket role

The bot automatically creates/fetches this exact role:

`Tickets Support`

Give the bot permission to manage channels/roles as required.

## 4. Ticket setup

Create individual panels:

`/panel type:support`
`/panel type:exchange`
`/panel type:staffhire`
`/panel type:eventjoin`

Each panel receives a number automatically.

List them:

`/panels`

Edit:

`/editpanel num:1`

Delete completely:

`/delpanel num:1`

Create the four-type all-in-one menu:

`/allpanel`

## 5. Transcript log

Set the transcript channel:

`/setticketlog channel:#your-log-channel`

Rating channel remains configurable with:

`/setrate channel:#your-rating-channel`

## 6. Ticket lifecycle

Open → channel name is `support-user`, `exchange-user`, `staffhire-user`, or `eventjoin-user`.

The ticket mentions Tickets Support + the opener.

Close → opener loses channel access, Tickets Support keeps access, and the opener receives the rating DM.

Staff buttons → Delete / Transcript / Reopen.

Reopen → opener regains access and is mentioned together with Tickets Support.
