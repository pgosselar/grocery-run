# Grocery Run

A shared family grocery list that works like iOS Reminders. It's an installable PWA backed by a small self-hosted Node server.

- **Lists** with a color and icon, drag to reorder (tap **Edit**)
- **Items:** tap **New Item**, type, press return, and keep typing. "2 avocados" sets the quantity.
- **Store sections:** items sort into Produce, Dairy, Bakery and so on automatically. You can turn this off per list or move items by hand.
- **Check off** an item and it lingers for a moment, then hides. Show or clear completed items from the `•••` menu.
- **Swipe left** to flag or delete. A long swipe deletes.
- **ⓘ on every item** shows who added it and when, plus who checked it off. **Edit Details** covers notes, quantity, section, flag, and moving to another list.
- **History** for each section shows the last 10 items checked off, with who added and completed each one, and a button to add an item again. The server keeps this log, so it survives **Clear Completed**.
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
FAMILY_PASSCODE=something npm start   # serves app + API on :3001
```

Or with Docker Compose (this is how it runs on the home server):

```sh
docker compose up -d --build     # first run and after every code change
docker compose logs -f           # logs
```

The passcode and session secret live in `.env`, which is gitignored. The database is in `./data/grocery.db`, so back up that folder.

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
| `FAMILY_PASSCODE` | *(empty)* | Shared passcode. Empty means no login, so only leave it empty on a trusted network. |
| `SESSION_SECRET` | derived | Set this to keep sessions valid if you change the passcode. |

### HTTPS (needed to install on iPhone)

iOS only installs PWAs and runs the offline service worker over HTTPS. Options:

- **Nginx Proxy Manager** (see above)
- **Tailscale** (no ports exposed): `tailscale serve --bg 3001`. Each family phone with Tailscale gets `https://<machine>.<tailnet>.ts.net`.
- **Caddy** with a domain: `groceries.example.com { reverse_proxy localhost:3001 }`

Then in Safari, tap **Share**, then **Add to Home Screen**.
