// api/room.js
// Stores each game room as two Redis keys (a version counter and a JSON state blob)
// in Upstash Redis, accessed over its HTTP REST API (no TCP, no SDK dependency).
//
// Moves are computed and validated entirely in the browser (see index.html) using
// the same rules engine for both players; this endpoint's only job is to hold the
// shared state and apply updates atomically so two simultaneous submissions can't
// silently clobber each other. See README.md for the honest limitations of this
// approach.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days of inactivity

// Atomic compare-and-swap: only writes the new state if the stored version still
// matches what the client last saw. KEYS = [versionKey, stateKey], ARGV = [expectedVersion, newStateJson].
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur == false then cur = '0' end
if cur == ARGV[1] then
  local newVersion = tostring(tonumber(cur) + 1)
  redis.call('SET', KEYS[1], newVersion)
  redis.call('SET', KEYS[2], ARGV[2])
  redis.call('EXPIRE', KEYS[1], ${ROOM_TTL_SECONDS})
  redis.call('EXPIRE', KEYS[2], ${ROOM_TTL_SECONDS})
  return 'OK:' .. newVersion
else
  return 'CONFLICT:' .. cur
end
`;

function keysFor(id) {
  return [`meridian:room:${id}:v`, `meridian:room:${id}:s`];
}

async function redisCall(body) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `Redis HTTP ${res.status}`);
  }
  return json.result;
}

async function redisPipeline(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Redis pipeline HTTP ${res.status}`);
  return json;
}

async function getRoom(id) {
  const [vkey, skey] = keysFor(id);
  const result = await redisPipeline([['GET', vkey], ['GET', skey]]);
  const versionRaw = result[0] && result[0].result;
  const stateRaw = result[1] && result[1].result;
  const version = versionRaw ? parseInt(versionRaw, 10) : 0;
  const state = stateRaw ? JSON.parse(stateRaw) : null;
  return { exists: !!state, version, state };
}

async function commitRoom(id, expectedVersion, state) {
  const [vkey, skey] = keysFor(id);
  const stateJson = JSON.stringify(state);
  const result = await redisCall(['EVAL', CAS_SCRIPT, '2', vkey, skey, String(expectedVersion), stateJson]);
  if (typeof result !== 'string') throw new Error('Unexpected response from store.');
  if (result.startsWith('OK:')) {
    return { ok: true, version: parseInt(result.slice(3), 10) };
  }
  if (result.startsWith('CONFLICT:')) {
    const currentVersion = parseInt(result.slice('CONFLICT:'.length), 10);
    const current = await getRoom(id);
    return { ok: false, version: currentVersion, state: current.state };
  }
  throw new Error('Unexpected response from store: ' + result);
}

export default async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(500).json({
      error: 'Server is missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN environment variables. See README.md.',
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const id = String(req.query.id || '');
      if (!ROOM_ID_RE.test(id)) {
        res.status(400).json({ error: 'Invalid room id.' });
        return;
      }
      const room = await getRoom(id);
      res.status(200).json(room);
      return;
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      const { id, expectedVersion, state } = body;
      if (!ROOM_ID_RE.test(String(id || ''))) {
        res.status(400).json({ error: 'Invalid room id.' });
        return;
      }
      if (typeof expectedVersion !== 'number' || !state || typeof state !== 'object') {
        res.status(400).json({ error: 'Missing expectedVersion or state.' });
        return;
      }
      const result = await commitRoom(id, expectedVersion, state);
      res.status(200).json(result);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
