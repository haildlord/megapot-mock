const express = require('express');
const cors = require('cors');

// Load the historical seed data
const rawData = require('./seed_data.json');
const seedRounds = new Map();

// Parse and index the JSON seed data by ID
const dataArray = Array.isArray(rawData) ? rawData : (rawData.data || []);
for (const round of dataArray) {
  seedRounds.set(String(round.id), round);
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuration
const ROUND_DURATION_MS = 3 * 60 * 1000; // 3 Minutes
const SETTLEMENT_DELAY_MS = 10 * 1000;    // 10 seconds

// Set a base chronological anchor. We backdate this so Epoch 1 is already settled 
// and Epoch 2 is immediately the active epoch on server boot.
const SERVER_BOOT_TIME = Date.now();
const BASE_TIME_MS = SERVER_BOOT_TIME - ROUND_DURATION_MS - SETTLEMENT_DELAY_MS;

// Calculate current active round ID dynamically based on Date.now()
function getCurrentActiveRoundId() {
  const now = Date.now();
  // We subtract the delay so the round ID only increments 45 seconds AFTER the 15m mark
  const effectiveTimePassed = Math.max(0, now - BASE_TIME_MS - SETTLEMENT_DELAY_MS);
  return Math.floor(effectiveTimePassed / ROUND_DURATION_MS) + 1;
}

// Fallback logic in case the server runs longer than the mock data provided
function getSeedData(id) {
  if (seedRounds.has(String(id))) {
    return seedRounds.get(String(id));
  }
  // If we run out of historical data, clone the last available round and fake it
  const fallback = seedRounds.get("131") || seedRounds.get("0") || {};
  const copy = JSON.parse(JSON.stringify(fallback));
  copy.id = String(id);
  return copy;
}

// Generates the accurate state of ANY round based purely on current time
function getTransformedRound(idStr, currentActiveIdStr) {
  const id = parseInt(idStr, 10);
  const currentActiveId = parseInt(currentActiveIdStr, 10);

  // Future rounds shouldn't be exposed yet
  if (id > currentActiveId) return null;

  const seed = getSeedData(id);
  const round = JSON.parse(JSON.stringify(seed)); // Deep clone

  // Calculate strict mathematically aligned boundaries
  const roundStartMs = BASE_TIME_MS + (id - 1) * ROUND_DURATION_MS;
  const roundEndMs = roundStartMs + ROUND_DURATION_MS;

  round.id = String(id);
  round.started_at = new Date(roundStartMs).toISOString();
  round.ended_at = new Date(roundEndMs).toISOString();

  if (id === currentActiveId) {
    // -----------------------------------------------------
    // ACTIVE ROUND MASKING
    // -----------------------------------------------------
    round.status = "active";
    round.settled_at = null;
    round.winning_numbers = null;
    round.winners_count = 0;
    round.top_prize_amount = null;
    round.top_prize_winners_count = 0;
    if (round.lp_earnings) round.lp_earnings.amount = "0";

    // Zero out ticket counts for active tiers, keep static payouts
    if (round.prize_tiers) {
      round.prize_tiers.forEach(tier => {
        tier.ticket_count = 0;
      });
    }
  } else {
    // -----------------------------------------------------
    // SETTLED ROUND
    // -----------------------------------------------------
    round.status = "settled";
    round.settled_at = new Date(roundEndMs + SETTLEMENT_DELAY_MS).toISOString();
  }

  return round;
}


// --- API Routes ---

// 1. GET /rounds/active
const getActiveHandler = (req, res) => {
  const activeId = String(getCurrentActiveRoundId());
  const activeRound = getTransformedRound(activeId, activeId);
  return res.json(activeRound);
};
app.get('/rounds/active', getActiveHandler);
app.get('/v1/rounds/active', getActiveHandler);

// 2. GET /rounds/:id
const getRoundByIdHandler = (req, res) => {
  const activeId = String(getCurrentActiveRoundId());
  const round = getTransformedRound(req.params.id, activeId);
  if (!round) {
    return res.status(404).json({ error: "Round not found or has not started yet" });
  }
  return res.json(round);
};
app.get('/rounds/:id', getRoundByIdHandler);
app.get('/v1/rounds/:id', getRoundByIdHandler);

// 3. GET /rounds (List with Cursor Pagination)
const getRoundsListHandler = (req, res) => {
  const cursor = req.query.cursor;
  const limit = parseInt(req.query.limit || '100', 10);
  const activeId = getCurrentActiveRoundId();

  // Generate the list from active round sequentially downwards to 0
  let allRounds = [];
  for (let i = activeId; i >= 0; i--) {
    const roundData = getTransformedRound(String(i), String(activeId));
    if (roundData) allRounds.push(roundData);
  }

  let startIndex = 0;
  if (cursor) {
    try {
      const decodedCursorStr = Buffer.from(cursor, 'base64').toString('utf8');
      let cursorId = null;

      // Handle JSON structure: {"sort_key_value":82,"id":82}
      if (decodedCursorStr.startsWith('{')) {
        const parsed = JSON.parse(decodedCursorStr);
        cursorId = String(parsed.id);
      } else {
        cursorId = decodedCursorStr;
      }

      const foundIndex = allRounds.findIndex(r => r.id === cursorId);
      if (foundIndex !== -1) {
        startIndex = foundIndex + 1;
      }
    } catch (e) {
      console.error("Error decoding cursor:", e);
    }
  }

  const paginatedData = allRounds.slice(startIndex, startIndex + limit);
  const hasMore = (startIndex + limit) < allRounds.length;
  const lastItem = paginatedData[paginatedData.length - 1];

  // Encode the cursor identically to the real backend
  let nextCursorStr = null;
  if (hasMore && lastItem) {
    const cursorObj = { 
      sort_key_value: Number(lastItem.id), 
      id: Number(lastItem.id) 
    };
    nextCursorStr = Buffer.from(JSON.stringify(cursorObj)).toString('base64');
  }

  return res.json({
    data: paginatedData,
    next_cursor: nextCursorStr,
    has_more: hasMore
  });
};
app.get('/rounds', getRoundsListHandler);
app.get('/v1/rounds', getRoundsListHandler);

// Health check API
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.send('Megapot Mock API is running'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock server operating on port ${PORT}`);
  console.log(`Epoch duration configured strictly to 15 minutes.`);
});
