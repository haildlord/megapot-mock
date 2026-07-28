const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configurable timing parameters
const ROUND_DURATION_MS = 5 * 60 * 1000; // 5 Minutes
const SETTLEMENT_DELAY_MS = 45 * 1000;    // 45 seconds settlement lag

// Constant winning numbers per requirement
const WINNING_NUMBERS = {
  normals: [3, 10, 16, 22, 23],
  bonusball: 5
};

// Strict prize tiers template (Tiers 0 & 2 are 0 payout; Tiers 1 & 4 are always 1111112)
const PRIZE_TIERS_TEMPLATE = [
  { tier_id: 0, normal_matches: 0, bonusball_match: false, payout: { amount: "0", decimals: 6 }, ticket_count: 552 },
  { tier_id: 1, normal_matches: 0, bonusball_match: true, payout: { amount: "1111112", decimals: 6 }, ticket_count: 43 },
  { tier_id: 2, normal_matches: 1, bonusball_match: false, payout: { amount: "0", decimals: 6 }, ticket_count: 607 },
  { tier_id: 3, normal_matches: 1, bonusball_match: true, payout: { amount: "3309549", decimals: 6 }, ticket_count: 48 },
  { tier_id: 4, normal_matches: 2, bonusball_match: false, payout: { amount: "1111112", decimals: 6 }, ticket_count: 182 },
  { tier_id: 5, normal_matches: 2, bonusball_match: true, payout: { amount: "5947675", decimals: 6 }, ticket_count: 25 },
  { tier_id: 6, normal_matches: 3, bonusball_match: false, payout: { amount: "5196966", decimals: 6 }, ticket_count: 24 },
  { tier_id: 7, normal_matches: 3, bonusball_match: true, payout: { amount: "10381191", decimals: 6 }, ticket_count: 4 },
  { tier_id: 8, normal_matches: 4, bonusball_match: false, payout: { amount: "25831323", decimals: 6 }, ticket_count: 0 },
  { tier_id: 9, normal_matches: 4, bonusball_match: true, payout: { amount: "223593015", decimals: 6 }, ticket_count: 0 },
  { tier_id: 10, normal_matches: 5, bonusball_match: false, payout: { amount: "2318630935", decimals: 6 }, ticket_count: 0 },
  { tier_id: 11, normal_matches: 5, bonusball_match: true, payout: { amount: "229435573609", decimals: 6 }, ticket_count: 0 }
];

// In-Memory Database
let currentRoundId = 132; // Starting at 132 to match your backend logs
const roundsMap = new Map();

// Helper to construct a brand new active round
function createActiveRound(id, startTimeMs) {
  const startedAt = new Date(startTimeMs);
  const endedAt = new Date(startTimeMs + ROUND_DURATION_MS);

  return {
    id: String(id),
    status: "active",
    prize_pool: { amount: "1114728197854", decimals: 6 },
    ticket_count: 710,
    unique_participants: 182,
    winners_count: 0,
    top_prize_amount: null,
    top_prize_winners_count: 0,
    lp_earnings: { amount: "0", decimals: 6 },
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    settled_at: null,
    ball_pool: { normals_max: 30, bonusball_max: 10 },
    winning_numbers: null,
    prize_tiers: null,

    // Internal timestamps for logic evaluation
    _startedAtMs: startedAt.getTime(),
    _endedAtMs: endedAt.getTime()
  };
}

// Helper to generate past settled rounds for initial seed
function createSettledRound(id) {
  return {
    id: String(id),
    status: "settled",
    prize_pool: { amount: "1114856282642", decimals: 6 },
    ticket_count: 1485,
    unique_participants: 285,
    winners_count: 326,
    top_prize_amount: { amount: "9343072", decimals: 6 },
    top_prize_winners_count: 4,
    lp_earnings: { amount: "1338845285", decimals: 6 },
    started_at: new Date(Date.now() - (currentRoundId + 1 - id) * ROUND_DURATION_MS).toISOString(),
    ended_at: new Date(Date.now() - (currentRoundId - id) * ROUND_DURATION_MS).toISOString(),
    settled_at: new Date(Date.now() - (currentRoundId - id) * ROUND_DURATION_MS + 5000).toISOString(),
    ball_pool: { normals_max: 30, bonusball_max: 10 },
    winning_numbers: WINNING_NUMBERS,
    prize_tiers: PRIZE_TIERS_TEMPLATE
  };
}

// Initialize seed data (Rounds 1 up to currentRoundId - 1)
for (let i = 1; i < currentRoundId; i++) {
  roundsMap.set(String(i), createSettledRound(i));
}
// Set initial active round
roundsMap.set(String(currentRoundId), createActiveRound(currentRoundId, Date.now()));

// Dynamic State Engine: Evaluates time and advances epochs
function syncEpochState() {
  const now = Date.now();
  let activeRound = roundsMap.get(String(currentRoundId));

  // Check if current active round passed its ended_at + settlement delay
  if (now >= activeRound._endedAtMs + SETTLEMENT_DELAY_MS) {
    // 1. Settle current round
    activeRound.status = "settled";
    activeRound.settled_at = new Date(activeRound._endedAtMs + 30000).toISOString();
    activeRound.winning_numbers = WINNING_NUMBERS;
    activeRound.prize_tiers = PRIZE_TIERS_TEMPLATE;
    activeRound.winners_count = 326;
    activeRound.top_prize_amount = { amount: "9343072", decimals: 6 };
    activeRound.top_prize_winners_count = 4;
    activeRound.lp_earnings = { amount: "1338845285", decimals: 6 };

    // Clean internal keys before exposing
    delete activeRound._startedAtMs;
    delete activeRound._endedAtMs;

    // 2. Increment active round ID
    currentRoundId += 1;
    const newActive = createActiveRound(currentRoundId, now);
    roundsMap.set(String(currentRoundId), newActive);
  }
}

// middleware to run sync on every request
app.use((req, res, next) => {
  syncEpochState();
  next();
});

// Clean internal fields helper for responses
function cleanRound(round) {
  if (!round) return null;
  const copy = { ...round };
  delete copy._startedAtMs;
  delete copy._endedAtMs;
  return copy;
}

// API Routes

// 1. GET /rounds/active
const getActiveHandler = (req, res) => {
  const activeRound = roundsMap.get(String(currentRoundId));
  return res.json(cleanRound(activeRound));
};
app.get('/rounds/active', getActiveHandler);
app.get('/v1/rounds/active', getActiveHandler);

// 2. GET /rounds/:id
const getRoundByIdHandler = (req, res) => {
  const round = roundsMap.get(req.params.id);
  if (!round) {
    return res.status(404).json({ error: "Round not found" });
  }
  return res.json(cleanRound(round));
};
app.get('/rounds/:id', getRoundByIdHandler);
app.get('/v1/rounds/:id', getRoundByIdHandler);

// 3. GET /rounds (List with Cursor Pagination)
const getRoundsListHandler = (req, res) => {
  const cursor = req.query.cursor;
  const limit = parseInt(req.query.limit || '100', 10);

  // Convert map values to array sorted descending by numeric ID
  let allRounds = Array.from(roundsMap.values())
    .map(r => cleanRound(r))
    .sort((a, b) => Number(b.id) - Number(a.id));

  let startIndex = 0;
  if (cursor) {
    try {
      // Decode the base64 cursor back to a string ID
      const decodedCursor = Buffer.from(cursor, 'base64').toString('utf8');
      
      const foundIndex = allRounds.findIndex(r => r.id === decodedCursor);
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

  return res.json({
    data: paginatedData,
    next_cursor: hasMore && lastItem ? Buffer.from(lastItem.id).toString('base64') : null,
    has_more: hasMore
  });
};
app.get('/rounds', getRoundsListHandler);
app.get('/v1/rounds', getRoundsListHandler);

// Health check
app.get('/', (req, res) => res.send('Megapot Mock API is running'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock server operating on port ${PORT}`);
});