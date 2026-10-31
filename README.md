# Plain Text Tables

Plain Text Tables brings back plain text table editing in Live Preview. Since Obsidian 1.5.3, Live Preview always draws a Markdown table as a table editor, and you must switch the whole note to Source mode to see the pipes. With this plugin, the table that holds the cursor shows as Markdown text lines. The rest of the note stays in Live Preview. When the cursor leaves the table, Obsidian draws it again.

This answers the forum request [Add toggle for plaintext table editing (source mode) in Live Preview](https://forum.obsidian.md/t/73866).

## Features

### Table text while the cursor is in the table

Move the cursor into a table with the arrow keys, or click a cell. The table shows as its Markdown lines, with pipes and the delimiter row. The rows are normal editor lines, as in Source mode, so the editor commands act on the text. Other tables in the note stay drawn.

<img src="https://raw.githubusercontent.com/theluckystrike/plain-text-tables/HEAD/docs/plain-text-tables.gif" alt="A note in Live Preview: the cursor moves into a reading list table, the table shows as Markdown text, a cell changes, and the table is drawn again when the cursor leaves" width="720">

Free: table text in Live Preview for every table, the click on a cell, the command and the setting. Pro: column alignment when you leave a table, and a command that aligns the current table. $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=plain-text-tables).

### Only the table with the cursor changes

The first table shows as text while the cursor is in it. The second table under the heading stays as Obsidian draws it.

<img src="https://raw.githubusercontent.com/theluckystrike/plain-text-tables/HEAD/docs/table-text.png" alt="Live Preview with the cursor in the first table: its rows show as Markdown text with pipes, and the second table is still drawn" width="720">

### Tables are drawn as usual when the cursor is out

When the cursor is not in a table, the note looks the same as without the plugin. The plugin does not change how Obsidian draws a table, and it does not change Reading view or Source mode.

<img src="https://raw.githubusercontent.com/theluckystrike/plain-text-tables/HEAD/docs/table-drawn.png" alt="Live Preview with the cursor on the heading: both tables are drawn as Obsidian draws them" width="720">

### Column alignment (Pro)

With the Pro setting "Align columns when you leave a table", the plugin pads the cells of a table that you changed, so that the pipes line up in the file. It also writes the delimiter row again with the alignment colons. It runs when the cursor leaves the table, and only when the table text changed while the cursor was in it. One undo removes the padding and keeps your edit. The Pro command "Align the current table" does the same at any time, for the table that holds the cursor.

<img src="https://raw.githubusercontent.com/theluckystrike/plain-text-tables/HEAD/docs/align.png" alt="A budget table as Markdown text with the pipes lined up after an edit" width="720">

## Install

When Plain Text Tables is listed in the community directory, open Settings, then Community plugins, then Browse, and search for "Plain Text Tables". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put the three files in `<vault>/.obsidian/plugins/plain-text-tables/`. Restart Obsidian or reload the list of community plugins, then turn on Plain Text Tables. You need Obsidian 1.13.4 or later.

## Usage

There is nothing to set up. Open a note with a table in Live Preview.

1. Put the cursor in the table. Use the Up or Down key from the line above or below, or click a cell.
2. Edit the Markdown text of the table. Add a row with a new line that starts with a pipe.
3. Move the cursor out of the table. Obsidian draws it again.

A click on a cell puts the cursor at the end of the text of that cell. While the feature is on, the table editor of Obsidian does not open, because the cursor in a table shows the text. To use the table editor, turn the feature off with the command below.

The plugin uses the same table rules as Obsidian. A table needs a header row and a delimiter row such as `|---|:-:|`. A table in a code block, a quote, a callout or a math block keeps the Obsidian look. A table right under a line of text is part of that paragraph, as in Obsidian.

To turn the feature off for a moment, run the command "Toggle table text" from the command palette, or give it a hotkey. Each table is drawn again at once.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | What it does |
| --- | --- |
| Show table text when the cursor is in a table | On by default. Off: tables behave as without the plugin. |
| Align columns when you leave a table | Pro. Pads the cells of a changed table when the cursor leaves it. Off by default. |

<img src="https://raw.githubusercontent.com/theluckystrike/plain-text-tables/HEAD/docs/settings.png" alt="The settings tab with the table text setting, the Pro alignment setting and the Pro section below them" width="720">

## Pro

To sign in and enable Pro:

1. Sponsor via [GitHub Sponsors](https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=plain-text-tables). A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of Plain Text Tables and select "Sign in with GitHub".
3. The plugin copies a code and opens github.com/login/device. Paste the code there and approve.

If you sponsor after you sign in, select Refresh. A negative sponsorship answer turns Pro off.

## FAQ

### Does it work in Source mode or Reading view?

Source mode already shows every table as text, so the plugin does nothing there. Reading view always draws tables. The plugin changes Live Preview only.

### How does it work?

Obsidian already shows a table as text in one case: when a search match from "Find" is in the table. The plugin uses the same mark for the table that holds the cursor. It puts the mark on the line break after the header row, so you do not see a highlight. The mark goes away when the cursor leaves. When Find removes its marks, the plugin adds its mark again in the same step. These parts of Obsidian are not in its public API. The plugin checks for them when it starts. On desktop, it also checks after each change that the table with the cursor is not drawn. If a part is missing, or Obsidian still draws that table, the plugin shows one notice, gives the tables back to the Obsidian table editor and stops until Obsidian restarts.

### Why does the table jump when I click a cell?

A table as text takes more or less height than the drawn table, so the lines under it move. The cursor and the row that you clicked stay in view.

### Does it change my tables?

The free version does not. With the Pro alignment setting on, the plugin changes the spaces in a table that you edited, when you leave it. It does not change the cell text.

### Does it work on mobile?

Tap a cell to show the table text. The tests run in the mobile emulation of Obsidian, which is not a real phone. The check that Obsidian does not draw the table with the cursor runs on desktop only. On mobile, if a table stays drawn while the cursor is in it, run the command "Toggle table text".

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=plain-text-tables. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Plain Text Tables makes no network requests. Sign in uses the GitHub device flow. Plain Text Tables sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Plain Text Tables sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [plain-text-tables](https://notemods.com/plugins/plain-text-tables/).

Report bugs and ask for features in the GitHub issues of this repository. Add your Obsidian version and a small sample note.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
