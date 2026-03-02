const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'opportunities.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_url TEXT,
    title TEXT NOT NULL,
    description TEXT,
    payout TEXT,
    payout_currency TEXT DEFAULT 'USDC',
    required_skills TEXT,
    location TEXT,
    deadline TEXT,
    author TEXT,
    post_url TEXT UNIQUE,
    category TEXT,
    status TEXT DEFAULT 'open',
    scraped_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_source ON opportunities(source);
  CREATE INDEX IF NOT EXISTS idx_category ON opportunities(category);
  CREATE INDEX IF NOT EXISTS idx_scraped_at ON opportunities(scraped_at);
  CREATE INDEX IF NOT EXISTS idx_author ON opportunities(author);
  
  -- Completion tracking table
  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER,
    post_url TEXT UNIQUE,
    author TEXT,
    source TEXT,
    status TEXT DEFAULT 'unknown',
    completed_at TEXT,
    paid BOOLEAN DEFAULT 0,
    paid_amount TEXT,
    checked_at TEXT,
    check_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_completions_author ON completions(author);
  CREATE INDEX IF NOT EXISTS idx_completions_status ON completions(status);
  CREATE INDEX IF NOT EXISTS idx_completions_paid ON completions(paid);
  
  -- Poster reputation table
  CREATE TABLE IF NOT EXISTS poster_reputation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT UNIQUE,
    source TEXT,
    total_posted INTEGER DEFAULT 0,
    total_completed INTEGER DEFAULT 0,
    total_paid INTEGER DEFAULT 0,
    total_unpaid INTEGER DEFAULT 0,
    avg_payout TEXT DEFAULT '0',
    reputation_score INTEGER DEFAULT 50,
    last_updated TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_reputation_author ON poster_reputation(author);
  CREATE INDEX IF NOT EXISTS idx_reputation_score ON poster_reputation(reputation_score);
  
  -- Featured listings table
  CREATE TABLE IF NOT EXISTS featured_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_url TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    source TEXT,
    price_paid TEXT DEFAULT '0.50',
    paid_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_featured_active ON featured_listings(active);
  CREATE INDEX IF NOT EXISTS idx_featured_expires ON featured_listings(expires_at);
`);

// Basic opportunity functions
function insertOpportunity(opp) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO opportunities 
    (source, source_url, title, description, payout, payout_currency, 
     required_skills, location, deadline, author, post_url, category, status, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  var result = stmt.run(
    opp.source || '',
    opp.sourceUrl || '',
    opp.title || '',
    opp.description || '',
    opp.payout || '',
    opp.payoutCurrency || 'USDC',
    JSON.stringify(opp.requiredSkills || []),
    opp.location || '',
    opp.deadline || '',
    opp.author || '',
    opp.postUrl || opp.source + '-' + Date.now() + '-' + Math.random(),
    opp.category || '',
    opp.status || 'open',
    opp.scrapedAt || new Date().toISOString()
  );
  
  // Also track in completions table for new opportunities
  if (result.changes > 0 && opp.author) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO completions (opportunity_id, post_url, author, source, status, created_at)
        VALUES (?, ?, ?, ?, 'open', ?)
      `).run(result.lastInsertRowid, opp.postUrl, opp.author, opp.source, new Date().toISOString());
      
      // Update poster stats
      updatePosterStats(opp.author, opp.source);
    } catch (e) {
      // Ignore duplicate errors
    }
  }
  
  return result;
}

function getRecentOpportunities(limit, source, category) {
  limit = limit || 50;
  var query = 'SELECT * FROM opportunities WHERE 1=1';
  var params = [];
  
  if (source) {
    query += ' AND source = ?';
    params.push(source);
  }
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  
  query += ' ORDER BY scraped_at DESC LIMIT ?';
  params.push(limit);
  
  return db.prepare(query).all.apply(db.prepare(query), params);
}

function getStats() {
  return {
    total: db.prepare('SELECT COUNT(*) as count FROM opportunities').get().count,
    bySource: db.prepare('SELECT source, COUNT(*) as count FROM opportunities GROUP BY source').all(),
    lastScrape: db.prepare('SELECT MAX(scraped_at) as last FROM opportunities').get().last
  };
}

function clearAll() {
  db.exec('DELETE FROM opportunities');
}

// Completion tracking functions
function updateCompletionStatus(postUrl, status, paid, paidAmount) {
  var stmt = db.prepare(`
    UPDATE completions 
    SET status = ?, paid = ?, paid_amount = ?, completed_at = ?, checked_at = ?, check_count = check_count + 1
    WHERE post_url = ?
  `);
  
  var now = new Date().toISOString();
  stmt.run(status, paid ? 1 : 0, paidAmount || '', status === 'completed' ? now : null, now, postUrl);
  
  // Update poster reputation
  var completion = db.prepare('SELECT author, source FROM completions WHERE post_url = ?').get(postUrl);
  if (completion) {
    updatePosterStats(completion.author, completion.source);
  }
}

function updatePosterStats(author, source) {
  if (!author) return;
  
  // Calculate stats from completions
  var stats = db.prepare(`
    SELECT 
      COUNT(*) as total_posted,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as total_completed,
      SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) as total_paid,
      SUM(CASE WHEN status = 'completed' AND paid = 0 THEN 1 ELSE 0 END) as total_unpaid
    FROM completions 
    WHERE author = ?
  `).get(author);
  
  // Calculate reputation score (0-100)
  var score = 50; // Base score
  if (stats.total_posted > 0) {
    var payRate = stats.total_paid / Math.max(1, stats.total_completed);
    var completionRate = stats.total_completed / stats.total_posted;
    score = Math.round((payRate * 70) + (completionRate * 30));
    score = Math.min(100, Math.max(0, score));
  }
  
  // Upsert reputation
  db.prepare(`
    INSERT INTO poster_reputation (author, source, total_posted, total_completed, total_paid, total_unpaid, reputation_score, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(author) DO UPDATE SET
      total_posted = excluded.total_posted,
      total_completed = excluded.total_completed,
      total_paid = excluded.total_paid,
      total_unpaid = excluded.total_unpaid,
      reputation_score = excluded.reputation_score,
      last_updated = excluded.last_updated
  `).run(author, source || '', stats.total_posted, stats.total_completed, stats.total_paid, stats.total_unpaid, score, new Date().toISOString());
}

function getPosterReputation(author) {
  return db.prepare('SELECT * FROM poster_reputation WHERE author = ?').get(author);
}

function getVerifiedOpportunities(limit, minScore) {
  limit = limit || 50;
  minScore = minScore || 70;
  
  return db.prepare(`
    SELECT o.*, pr.reputation_score, pr.total_paid, pr.total_posted
    FROM opportunities o
    LEFT JOIN poster_reputation pr ON o.author = pr.author
    WHERE pr.reputation_score >= ? OR pr.reputation_score IS NULL
    ORDER BY pr.reputation_score DESC, o.scraped_at DESC
    LIMIT ?
  `).all(minScore, limit);
}

function getTopPosters(limit) {
  limit = limit || 20;
  return db.prepare(`
    SELECT * FROM poster_reputation 
    WHERE total_posted > 0
    ORDER BY reputation_score DESC, total_paid DESC
    LIMIT ?
  `).all(limit);
}

function getCompletionStats() {
  return {
    total: db.prepare('SELECT COUNT(*) as count FROM completions').get().count,
    completed: db.prepare("SELECT COUNT(*) as count FROM completions WHERE status = 'completed'").get().count,
    paid: db.prepare('SELECT COUNT(*) as count FROM completions WHERE paid = 1').get().count,
    open: db.prepare("SELECT COUNT(*) as count FROM completions WHERE status = 'open'").get().count
  };
}

// Featured listing functions
function addFeaturedListing(postUrl, title, author, source, pricePaid, durationHours) {
  durationHours = durationHours || 24;
  var now = new Date();
  var expires = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
  
  db.prepare(`
    INSERT OR REPLACE INTO featured_listings (post_url, title, author, source, price_paid, paid_at, expires_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(postUrl, title, author || '', source || '', pricePaid || '0.50', now.toISOString(), expires.toISOString());
}

function getActiveFeaturedListings() {
  var now = new Date().toISOString();
  // Also expire old listings
  db.prepare("UPDATE featured_listings SET active = 0 WHERE expires_at < ? AND active = 1").run(now);
  
  return db.prepare(`
    SELECT f.*, o.description, o.payout, o.payout_currency, o.category, o.status
    FROM featured_listings f
    LEFT JOIN opportunities o ON f.post_url = o.post_url
    WHERE f.active = 1 AND f.expires_at > ?
    ORDER BY f.paid_at DESC
  `).all(now);
}

function getFeaturedStats() {
  return {
    active: db.prepare("SELECT COUNT(*) as count FROM featured_listings WHERE active = 1 AND expires_at > ?").get(new Date().toISOString()).count,
    total: db.prepare("SELECT COUNT(*) as count FROM featured_listings").get().count
  };
}

module.exports = { 
  db: db, 
  insertOpportunity: insertOpportunity, 
  getRecentOpportunities: getRecentOpportunities, 
  getStats: getStats, 
  clearAll: clearAll,
  addFeaturedListing: addFeaturedListing,
  getActiveFeaturedListings: getActiveFeaturedListings,
  getFeaturedStats: getFeaturedStats,
  // New completion tracking exports
  updateCompletionStatus: updateCompletionStatus,
  updatePosterStats: updatePosterStats,
  getPosterReputation: getPosterReputation,
  getVerifiedOpportunities: getVerifiedOpportunities,
  getTopPosters: getTopPosters,
  getCompletionStats: getCompletionStats
};