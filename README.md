# Meridian — online

Meridian is a 1v1 board game on a 19×19 lattice centered on (0,0). Blue
starts with two nodes at (-9,0) and (-6,0) joined by an edge; Red starts the
mirror image at (6,0) and (9,0). Grow a network out from there, or attack an
opponent node by placing directly on it (deleting every edge attached to
it). Any opponent edge your move breaks must be strictly longer than the
edge you're placing — no limit on how many you can break in one move, as
long as each one qualifies. Breaking an edge only removes that edge, plus
any node it leaves with no edges at all — nothing cascades further. At the
end of each turn, the total area enclosed by your own edges (draw them,
flood fill the outside, whatever never gets touched is "enclosed" — computed
exactly via a planar-arrangement algorithm, not a grid approximation) is
added to your score. First to 300 points wins.

This is a small static site (`index.html`) plus one serverless function
(`api/room.js`) that lets two people play together online by sharing a link,
in addition to the original local hotseat mode (both players on one screen,
one device).

## How online play works

- One player clicks **Create a room** and picks a color; this generates a
  room code and a shareable link (`?room=XXXXXX`).
- The other player opens that link and is assigned the remaining color
  (or picks, if both are somehow still open).
- Each move is computed and checked against the rules locally in the mover's
  browser, then pushed to a small shared store. Both browsers poll for
  updates every ~1.5 seconds, so a move shows up on the other screen shortly
  after it's made.
- **Undo/redo are turned off online** — rewriting a move your opponent
  already saw wouldn't make sense over a shared connection. They still work
  normally in local hotseat mode.
- **New game** resets the room for both players and keeps the same color
  assignments.
- Rooms expire automatically after 7 days of inactivity — nothing to clean
  up by hand.

## What you need to deploy it

A single free Redis database from [Upstash](https://upstash.com) is used as
the shared store, accessed over its HTTP REST API (no persistent connection,
which is what makes it work from a serverless function). Vercel's own former
"Vercel KV" product has been retired in favor of this same Upstash-backed
approach, so this is the current recommended path.

### 1. Create a free Upstash Redis database (2 minutes)

- Go to [upstash.com](https://upstash.com) and sign up (free, no card).
- Create a **Redis** database (any region close to you is fine).
- On the database page, find the **REST API** section and copy the two
  values you'll need in step 3:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

### 2. Put this code on GitHub

- Unzip this project on your computer.
- Create a new repository on [github.com](https://github.com) (public or
  private, either is fine).
- Use **Add file → Upload files** and drag in everything from the unzipped
  folder — `index.html`, `package.json`, `README.md`, `.gitignore`, and the
  whole `api` folder. Modern browsers preserve the folder structure when you
  drag a folder in.
- Commit.

### 3. Deploy on Vercel

- Go to [vercel.com](https://vercel.com), sign up (easiest via **Continue
  with GitHub**, since it links your account automatically).
- **Add New… → Project**, import the repository you just created.
- Before clicking **Deploy**, expand **Environment Variables** and add both:
  - `UPSTASH_REDIS_REST_URL` → the value from step 1
  - `UPSTASH_REDIS_REST_TOKEN` → the value from step 1
- Click **Deploy**.

### 4. Play

You'll get a URL like `meridian-online-yourname.vercel.app`. Open it, click
the **Online** tab, **Create a room**, pick a color, then send the link
(with its `?room=...`) to a friend.

---

**Forgot the environment variables before deploying?** No problem — go to
the project in Vercel, **Settings → Environment Variables**, add them there,
then **Deployments → ⋯ → Redeploy** on the latest deployment.

**Prefer a terminal?** Install Node.js, then from the unzipped folder:
`npm install -g vercel`, then `vercel`, then
`vercel env add UPSTASH_REDIS_REST_URL production` and the same for the
token (pasting the values when prompted), then `vercel --prod`.

## Notes / limitations

- The server trusts whatever state the active player's browser sends rather
  than re-validating every rule itself — the right tradeoff for playing with
  friends, but worth knowing. Both browsers run the exact same rules engine,
  so this only matters if someone tampers with their own client.
- No spectator chat, no move history log beyond the current board, no
  reconnection notifications — intentionally minimal.
- If both of you act at the exact same instant (rare in a turn-based game,
  and normally prevented by only the active player being able to move),
  you'll see "the board just changed" — just try again.
- The Redis credentials only ever touch `api/room.js` on the server; they're
  never sent to the browser.
- A spectator (anyone who opens the room link after both colors are taken)
  gets a live read-only view of the board.
