PRAGMA foreign_keys = ON;
CREATE TABLE sessions (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL);
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id),
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closing','closed')),
  chosen TEXT, close_token TEXT, refund_token TEXT, createdAt TEXT NOT NULL, closedAt TEXT
);
CREATE INDEX campaigns_session ON campaigns(sessionId, createdAt);
CREATE UNIQUE INDEX campaigns_one_open ON campaigns(sessionId) WHERE state IN ('open','closing');
CREATE TABLE preorders (
  id TEXT PRIMARY KEY, campaignId TEXT NOT NULL REFERENCES campaigns(id),
  venue TEXT NOT NULL CHECK(venue IN ('wharf','mill','linden')),
  product TEXT NOT NULL CHECK(product IN ('tin','jar','trio')),
  qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 3), amountCents INTEGER NOT NULL CHECK(amountCents > 0),
  state TEXT NOT NULL, orderId TEXT UNIQUE, captureId TEXT UNIQUE, refundId TEXT UNIQUE,
  debugId TEXT, approveUrl TEXT, simulated INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'live'
);
CREATE INDEX preorders_campaign ON preorders(campaignId);
CREATE INDEX preorders_day ON preorders(createdAt);
CREATE TABLE ops (
  requestId TEXT PRIMARY KEY, preorderId TEXT NOT NULL REFERENCES preorders(id),
  kind TEXT NOT NULL, status TEXT NOT NULL, http INTEGER, paypalId TEXT,
  at TEXT NOT NULL, retryCount INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE events (
  event_id TEXT PRIMARY KEY, type TEXT NOT NULL, resourceId TEXT NOT NULL,
  customId TEXT NOT NULL, campaignId TEXT, status TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX events_unfinished ON events(status,campaignId);
CREATE TABLE agent_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, expiresAt TEXT NOT NULL);
CREATE TABLE runs (id INTEGER PRIMARY KEY, day TEXT NOT NULL, visitor TEXT NOT NULL, neurons REAL NOT NULL DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE asks (id INTEGER PRIMARY KEY, day TEXT NOT NULL, visitor TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE caps (key TEXT PRIMARY KEY, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
