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
  
  -- Email subscribers table
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    skills TEXT,
    verified INTEGER DEFAULT 0,
    subscribed_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
`);

// ========================================
// AGENTS & PROPOSALS TABLES
// ========================================

// Agents table - stores agent identities via API keys
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_hash TEXT UNIQUE NOT NULL,
    name TEXT,
    capabilities TEXT DEFAULT '[]',
    resume_text TEXT,
    cover_letter_template TEXT,
    webhook_url TEXT,
    notify_on_match INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_active TEXT
  );
  
  CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key_hash);
  
  -- Proposals table - stores job proposals for each agent
  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    job_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_name TEXT,
    job_title TEXT NOT NULL,
    job_description TEXT,
    job_url TEXT,
    payout REAL,
    currency TEXT,
    skills TEXT DEFAULT '[]',
    proposal_text TEXT,
    status TEXT DEFAULT 'found',
    matched_at TEXT DEFAULT CURRENT_TIMESTAMP,
    generated_at TEXT,
    submitted_at TEXT,
    accepted_at TEXT,
    rejected_at TEXT,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_proposals_agent ON proposals(agent_id);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_proposals_job ON proposals(job_id, source);
`);

// ========================================
// AGENT & PROPOSAL FUNCTIONS
// ========================================

const crypto = require('crypto');

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function generateApiKey() {
  return 'al_' + crypto.randomUUID().replace(/-/g, '');
}

function registerAgent(name, capabilities = []) {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  
  const stmt = db.prepare(`
    INSERT INTO agents (api_key_hash, name, capabilities)
    VALUES (?, ?, ?)
  `);
  
  const result = stmt.run(apiKeyHash, name, JSON.stringify(capabilities));
  
  return {
    id: result.lastInsertRowid,
    api_key: apiKey, // Plain text - shown ONLY once!
    name,
    capabilities,
    created_at: new Date().toISOString()
  };
}

function getAgentByApiKey(apiKey) {
  const apiKeyHash = hashApiKey(apiKey);
  const agent = db.prepare('SELECT * FROM agents WHERE api_key_hash = ?').get(apiKeyHash);
  
  if (agent) {
    agent.capabilities = JSON.parse(agent.capabilities || '[]');
    // Don't return the hash
    delete agent.api_key_hash;
  }
  
  return agent;
}

function updateAgentCapabilities(agentId, capabilities) {
  db.prepare('UPDATE agents SET capabilities = ?, last_active = ? WHERE id = ?')
    .run(JSON.stringify(capabilities), new Date().toISOString(), agentId);
}

function updateAgentProfile(agentId, data) {
  const updates = [];
  const params = [];
  
  if (data.name !== undefined) {
    updates.push('name = ?');
    params.push(data.name);
  }
  if (data.capabilities !== undefined) {
    updates.push('capabilities = ?');
    params.push(JSON.stringify(data.capabilities));
  }
  if (data.resume_text !== undefined) {
    updates.push('resume_text = ?');
    params.push(data.resume_text);
  }
  if (data.cover_letter_template !== undefined) {
    updates.push('cover_letter_template = ?');
    params.push(data.cover_letter_template);
  }
  if (data.webhook_url !== undefined) {
    updates.push('webhook_url = ?');
    params.push(data.webhook_url);
  }
  
  updates.push('last_active = ?');
  params.push(new Date().toISOString());
  params.push(agentId);
  
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  
  return getAgentById(agentId);
}

function getAgentById(agentId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (agent) {
    agent.capabilities = JSON.parse(agent.capabilities || '[]');
    delete agent.api_key_hash;
  }
  return agent;
}

function getAllAgents() {
  const agents = db.prepare('SELECT * FROM agents').all();
  return agents.map(a => {
    a.capabilities = JSON.parse(a.capabilities || '[]');
    delete a.api_key_hash;
    return a;
  });
}

function saveProposal(proposal) {
  const stmt = db.prepare(`
    INSERT INTO proposals 
    (agent_id, job_id, source, source_name, job_title, job_description, job_url, payout, currency, skills, proposal_text, status, matched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    proposal.agent_id,
    proposal.job_id,
    proposal.source,
    proposal.source_name || proposal.source,
    proposal.job_title,
    proposal.job_description || '',
    proposal.job_url || '',
    proposal.payout || 0,
    proposal.currency || 'USDC',
    JSON.stringify(proposal.skills || []),
    proposal.proposal_text || '',
    proposal.status || 'found',
    proposal.matched_at || new Date().toISOString()
  );
  
  return result.lastInsertRowid;
}

function proposalExists(agentId, jobId, source) {
  const existing = db.prepare(
    'SELECT id FROM proposals WHERE agent_id = ? AND job_id = ? AND source = ?'
  ).get(agentId, jobId, source);
  return !!existing;
}

function getAgentProposals(agentId, status = null, limit = 50) {
  let query = 'SELECT * FROM proposals WHERE agent_id = ?';
  const params = [agentId];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY matched_at DESC LIMIT ?';
  params.push(limit);
  
  const proposals = db.prepare(query).all(...params);
  
  return proposals.map(p => {
    let skills = [];
    try {
      skills = JSON.parse(p.skills || '[]');
    } catch(e) {
      // Handle comma-separated string
      if (typeof p.skills === 'string') {
        skills = p.skills.split(',').map(s => s.trim()).filter(s => s);
      }
    }
    return { ...p, skills };
  });
}

function updateProposalStatus(proposalId, status) {
  const now = new Date().toISOString();
  let updateField = status + '_at';
  
  db.prepare(`UPDATE proposals SET status = ?, ${updateField} = ? WHERE id = ?`)
    .run(status, now, proposalId);
}

function getAgentStats(agentId) {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) as found,
      SUM(CASE WHEN status = 'generated' THEN 1 ELSE 0 END) as generated,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM proposals WHERE agent_id = ?
  `).get(agentId);
  
  return stats;
}

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

// Subscriber functions - MUST be before module.exports
function addSubscriber(email, skills) {
  try {
    db.prepare('INSERT OR IGNORE INTO subscribers (email, skills) VALUES (?, ?)').run(email, skills || '');
    return { success: true, email: email };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getSubscribers() {
  return db.prepare('SELECT * FROM subscribers ORDER BY subscribed_at DESC').all();
}

function getSubscriberCount() {
  return db.prepare('SELECT COUNT(*) as count FROM subscribers').get().count;
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
  getCompletionStats: getCompletionStats,
  // Subscriber exports
  addSubscriber: addSubscriber,
  getSubscribers: getSubscribers,
  getSubscriberCount: getSubscriberCount,
  // Agent & Proposal exports
  registerAgent: registerAgent,
  getAgentByApiKey: getAgentByApiKey,
  updateAgentCapabilities: updateAgentCapabilities,
  saveProposal: saveProposal,
  getAgentProposals: getAgentProposals,
  updateProposalStatus: updateProposalStatus,
  getAgentStats: getAgentStats,
  generateApiKey: generateApiKey,
  getAllAgents: getAllAgents,
  proposalExists: proposalExists,
  updateAgentProfile: updateAgentProfile,
  getAgentById: getAgentById
};