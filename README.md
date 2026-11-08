# Grocery Run

Shared family grocery lists that work like iOS Reminders. It's an installable PWA backed by a small self-hosted Node server.

- **Accounts:** email and password, plus **Continue with Google** once it's configured. The first account is free to create; after that, people join through a list's invite link.
- **A list per store** (the regular grocery store, Costco, Trader Joe's…) with a color and icon. Each person orders their own lists screen (tap **Edit**).
- **Sharing:** tap the person icon on a list to see who's on it and send an invite link. Owners can remove people and reset the link; anyone else can leave. Only the owner can delete a list.
- **Sections per list:** `•••` → **Edit Sections** to drag sections into the order you walk that store, rename them, add or delete them, and edit the words that sort new items into each. Changes only affect new items.
- **Auto-sorting** matches words in the item's name. When several match, the one nearest the end wins ("chocolate milk" is milk, "orange juice" is juice), and "frozen" or "canned" anywhere wins over everything but a learned name.
- **Always put X in Y:** hold a finger on an item (or swipe it, or tap ⓘ) → **Move**, and pick a section. That list remembers the item for next time and says so, with an **Undo**: "Oat milk" can live in Frozen at Costco and in Dairy everywhere else.
- **Items:** tap **New Item**, type, press return, and keep typing. "2 avocados" sets the quantity.
- **Check off** an item and it lingers for a moment, then hides. Show or clear completed items from the `•••` menu.
- **Swipe left** to flag or delete. A long swipe deletes.
- **ⓘ on every item** shows who added it and when, plus who checked it off. **Edit Details** covers notes, quantity, section, flag, and moving to another list.
- **History** for each section shows the last 10 items checked off, with who added and completed each one, and a button to add an item again. The server keeps this log, so it survives **Clear Completed**.
- **Import from a recipe:** tap **From Recipe**, paste a link (or the ingredient text), review the cleaned-up items, and add them. Staples like salt and oil, and anything already on the list, start unticked. Each item's notes say which recipe it's for.
- **Suggestions** from past items as you type
- **Live sync:** websockets push every change to the other phones instantly.
- **Works offline.** Changes queue on the phone and sync when signal comes back. Conflicts resolve last-write-wins.

## Stack

React 19 + Vite + Tailwind v4 + shadcn-style components. Node 25 runs the server: Express, `ws`, and the built-in `node:sqlite`. There's no native build and no TS compile step for the server.

## Theme

All colors come from `src/theme.css`, which uses tweakcn's CSS variable format. To apply a tweakcn theme, open it on tweakcn.com, go to **Code**, copy the Tailwind v4 CSS, and replace the `:root` / `.dark` blocks. The app follows the system light/dark setting.

## Develop

```sh
npm install
npm run dev:server   # API + websocket on :3001
npm run dev:client   # Vite on :5173, proxies /api and /ws (also exposed on your LAN)
```

## Run in production

```sh
npm run build
npm start   # serves app + API on :3001
```

Or with Docker Compose (this is how it runs on the home server):

```sh
docker compose up -d --build     # first run and after every code change
docker compose logs -f           # logs
```

Settings and secrets live in `.env`, which is gitignored. The database is in `./data/grocery.db`, so back up that folder.

**First run:** the first person to open the app creates the first account, so do that yourself right after deploying. Then share a list with each family member.

### Accounts admin

There's no email verification. Without Resend configured, reset a forgotten password from the server:

```sh
docker compose exec grocery-run node server/cli.ts users
docker compose exec grocery-run node server/cli.ts reset-password someone@example.com   # prints a temporary password
```

### Password reset emails (optional)

1. In [Resend](https://resend.com), verify a domain you own and create an API key.
2. In `.env`, set `RESEND_API_KEY`, `EMAIL_FROM` (an address on that domain), and `PUBLIC_URL`. Then run `docker compose up -d`.

The sign-in screen then shows **Forgot password?**, which emails a one-hour, single-use link.

### Google sign-in (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. Set up the consent screen first if asked: External, with just your app name and email.
2. Under **Authorized redirect URIs**, add `https://<your domain>/api/auth/google/callback`.
3. In `.env`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL`. Then run `docker compose up -d`.

A Google account with the same email as an existing account gets connected to it. Because emails on password accounts aren't verified, connecting Google removes that account's password and signs out its other sessions; the person can add a new password under **Account**. New Google users still need an invite link.

### Nginx Proxy Manager

Add a Proxy Host with these settings:
- Scheme `http`, forward to this server's IP, port `3001`
- **Websockets Support: ON.** Live sync needs it.
- Cache Assets: off. The service worker handles caching, and a cached `sw.js` would delay updates.
- SSL tab: request a Let's Encrypt cert, then turn on Force SSL and HTTP/2.

| Env var | Default | |
|---|---|---|
| `PORT` | `3001` | |
| `DB_PATH` | `data/grocery.db` | SQLite file. Back this up. |
| `PUBLIC_URL` | from request | Public address, used in invite, reset, and Google links |
| `SESSION_SECRET` | stored in DB | Signs the Google sign-in handshake |
| `SIGNUPS` | `invite` | `open` lets anyone create an account without an invite |
| `RESEND_API_KEY`, `EMAIL_FROM` | *(unset)* | Password reset emails |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | *(unset)* | Continue with Google |
| `ANTHROPIC_API_KEY` | *(unset)* | Optional. Recipe import uses Claude to clean up ingredients, and falls back to the built-in rules if the call fails. |
| `RECIPE_MODEL` | `claude-opus-5-5` | Claude model for recipe cleanup |

### HTTPS (needed to install on iPhone)

iOS only installs PWAs and runs the offline service worker over HTTPS. Options:

- **Nginx Proxy Manager** (see above)
- **Tailscale** (no ports exposed): `tailscale serve --bg 3001`. Each family phone with Tailscale gets `https://<machine>.<tailnet>.ts.net`.
- **Caddy** with a domain: `groceries.example.com { reverse_proxy localhost:3001 }`

Then in Safari, tap **Share**, then **Add to Home Screen**.

## Recipe import: how it works

1. **Fetch** (`server/recipe/fetch.ts`): the server downloads the page, with a 12s timeout and a 5 MB cap. It refuses any address on a private network, so a link can't be used to probe your LAN. It identifies itself honestly, so sites that block automated requests get a "paste the ingredients instead" message.
2. **Extract** (`server/recipe/extract.ts`): reads the schema.org `Recipe` JSON-LD that recipe sites publish for search engines, and falls back to microdata. No HTML scraping.
3. **Clean** each line into title, quantity, notes, section, and whether it's a staple:
   - **Rules** (`server/recipe/ingredients.ts`): unicode fractions, units, parentheticals, prep words ("finely chopped"), costs like "($0.32)", "X or Y" alternatives, and canned goods. Duplicates are merged ("butter" in the crust and the filling).
   - **Claude** (`server/recipe/claude.ts`), when `ANTHROPIC_API_KEY` is set: one structured-output call that returns validated JSON, at low effort for speed. It's given the list's own section names (and sample words), so it sorts into *that store's* sections. Words the list has learned win over Claude's guess. Better on messy lines; usually costs a fraction of a cent per recipe.
