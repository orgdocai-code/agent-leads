require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const { getRecentOpportunities, getStats, db, addFeaturedListing, getActiveFeaturedListings, getFeaturedStats, addSubscriber, getSubscribers, getSubscriberCount } = require('./utils/database');
const { runAllScrapers } = require('./scraper-runner');
const { initX402 } = require('./utils/payment-router');
const { autobidder } = require('./utils/autobidder-v3');

// ========================================
// REAL-TIME FETCH FUNCTION
// ========================================
const DIRECT_SOURCES = {
  'github': {
    name: 'GitHub Bounties',
    url: 'https://api.github.com/search/issues?q=label:bounty+is:issue+state:open+language:javascript&per_page=30',
    headers: { 'User-Agent': 'AgentLeads' },
    parser: (issue) => ({
      id: `gh-${issue.id}`,
      source: 'github',
      sourceName: 'GitHub',
      title: issue.title,
      description: issue.body?.substring(0, 500) || '',
      payout: 0,
      currency: 'varies',
      url: issue.html_url || `https://github.com/${issue.repository_url?.replace('https://api.github.com/repos/', '')}/issues/${issue.number}`,
      status: 'open',
      skills: issue.labels?.map(l => l.name) || []
    })
  },
  'owockibot': {
    name: 'Owockibot',
    url: 'https://bounty.owockibot.xyz/bounties',
    parser: (bounty) => ({
      id: `ow-${bounty.id}`,
      source: 'owockibot',
      sourceName: 'Owockibot',
      title: bounty.title,
      description: bounty.description || '',
      payout: (parseFloat(bounty.reward) || 0) / 1000000,
      currency: 'USDC',
      url: `https://bounty.owockibot.xyz/bounty/${bounty.id}`,
      status: bounty.status === 'open' ? 'active' : 'closed',
      skills: bounty.tags || []
    })
  }
};

async function fetchAllSourcesRealTime(limit = 100) {
  const allJobs = [];
  
  // Fetch from each source in parallel
  const fetchPromises = Object.entries(DIRECT_SOURCES).map(async ([key, source]) => {
    try {
      const response = await axios.get(source.url, { 
        headers: source.headers,
        timeout: 10000 
      });
      
      let items = [];
      if (key === 'github') {
        items = response.data.items || [];
      } else if (key === 'owockibot') {
        items = response.data.bounties || response.data || [];
      }
      
      const jobs = items.map(item => source.parser(item)).filter(j => j);
      console.log(`[RealTime] ${source.name}: ${jobs.length} jobs`);
      return jobs;
    } catch (e) {
      console.error(`[RealTime] Error fetching ${source.name}:`, e.message);
      return [];
    }
  });
  
  const results = await Promise.all(fetchPromises);
  results.forEach(jobs => allJobs.push(...jobs));
  
  // Also get from our DB as fallback
  try {
    const dbJobs = getRecentOpportunities(200, null, null);
    allJobs.push(...dbJobs.map(j => ({...j, source: j.source || 'agentleads', sourceName: 'AgentLeads'})));
  } catch(e) {
    console.error('[RealTime] DB error:', e.message);
  }
  
  // Deduplicate by URL
  const seen = new Set();
  const unique = allJobs.filter(job => {
    if (seen.has(job.url)) return false;
    seen.add(job.url);
    return true;
  });
  
  return unique.slice(0, limit);
}

const app = express();
app.use(cors());
app.use(express.json());

// ========================================
// RATE LIMITING
// ========================================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per IP

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  // Clean old entries
  for (const [key, data] of rateLimitMap) {
    if (now - data.resetTime > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(key);
    }
  }
  
  let record = rateLimitMap.get(ip);
  if (!record || now - record.resetTime > RATE_LIMIT_WINDOW_MS) {
    record = { count: 0, resetTime: now };
    rateLimitMap.set(ip, record);
  }
  
  record.count++;
  
  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded', 
      retryAfter: Math.ceil((record.resetTime + RATE_LIMIT_WINDOW_MS - now) / 1000)
    });
  }
  
  next();
}

app.use(rateLimitMiddleware);

// ========================================
// INPUT VALIDATION
// ========================================
function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  // Remove potential XSS and injection characters
  return str.replace(/[<>'";&]/g, '').trim().substring(0, 1000);
}

function validateApiKey(key) {
  if (!key || typeof key !== 'string') return false;
  // API keys start with 'al_' and are 30+ chars
  return /^al_[a-z0-9]{30,}$/i.test(key);
}

function validateAgentName(name) {
  if (!name || typeof name !== 'string') return false;
  // 2-50 chars, alphanumeric + spaces only
  return /^[a-zA-Z0-9 ]{2,50}$/.test(name);
}

app.use('/autobid/', (req, res, next) => {
  // Sanitize request body
  if (req.body && typeof req.body === 'object') {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeInput(req.body[key]);
      }
    }
  }
  next();
});

const PORT = process.env.PORT || 3000;
const WALLET = process.env.WALLET_ADDRESS || '0xYourWalletHere';
const PRICE = process.env.PRICE_PER_REQUEST || '0.05';
const FEATURED_PRICE = process.env.FEATURED_PRICE || '0.50';

// Initialize x402 payment router
initX402(app);

// Initialize auto-bidder v3
autobidder.init(app);

// ========================================
// API KEY SYSTEM (Free Tier: 10 req/day)
// ========================================

// In-memory API key storage (for production, use database)
// Format: { 'key+ip': { requests: 0, resetDate: '2026-03-02', key: 'api-key', ip: '127.0.0.1' } }
const apiKeys = new Map();

// Global IP rate limiting (prevents 10 keys from same IP)
// Format: { '127.0.0.1': { requests: 0, resetDate: '2026-03-02' } }
const ipLimits = new Map();

const IP_FREE_LIMIT = 20; // Max 20 requests per IP per day regardless of keys
const KEY_FREE_LIMIT = 10; // Max 10 requests per key per IP

// Free trial keys (for testing) - these bypass limits
const FREE_TRIAL_KEYS = ['demo', 'test', 'free'];

// Check and increment API key usage
function checkApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || '';
  const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  
  // No API key? Check if they have x402 payment
  if (!apiKey) {
    return checkPayment(req, res, next);
  }
  
  // Demo keys always work
  if (FREE_TRIAL_KEYS.includes(apiKey.toLowerCase())) {
    return next();
  }
  
  const today = new Date().toISOString().split('T')[0];
  
  // Check global IP limit (prevent 10 keys from same IP)
  const ipData = ipLimits.get(clientIP);
  if (!ipData) {
    ipLimits.set(clientIP, { requests: 1, resetDate: today });
  } else if (ipData.resetDate !== today) {
    ipLimits.set(clientIP, { requests: 1, resetDate: today });
  } else if (ipData.requests >= IP_FREE_LIMIT) {
    return res.status(429).json({
      error: 'Rate Limit Exceeded',
      message: 'Free tier limit: ' + IP_FREE_LIMIT + ' requests per day per IP',
      limit: IP_FREE_LIMIT,
      currentIP: clientIP,
      resetAt: today + ' 00:00 UTC',
      upgrade: 'Visit https://agentleads.ai to get a paid API key'
    });
  } else {
    ipData.requests++;
    ipLimits.set(clientIP, ipData);
  }
  
  // Check per-key limit (10 per key per IP)
  const rateLimitKey = apiKey + ':' + clientIP;
  const keyData = apiKeys.get(rateLimitKey);
  
  if (!keyData) {
    apiKeys.set(rateLimitKey, { requests: 1, resetDate: today, key: apiKey, ip: clientIP });
    return next();
  }
  
  if (keyData.resetDate !== today) {
    apiKeys.set(rateLimitKey, { requests: 1, resetDate: today, key: apiKey, ip: clientIP });
    return next();
  }
  
  if (keyData.requests >= KEY_FREE_LIMIT) {
    return res.status(429).json({
      error: 'Rate Limit Exceeded',
      message: 'Free tier limit: ' + KEY_FREE_LIMIT + ' requests per day per API key',
      limit: KEY_FREE_LIMIT,
      currentIP: clientIP,
      resetAt: today + ' 00:00 UTC',
      upgrade: 'Visit https://agentleads.ai to get a paid API key'
    });
  }
  
  keyData.requests++;
  apiKeys.set(rateLimitKey, keyData);
  next();
}

// Get API key usage (for debugging)
app.get('/api-key/status', function(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.json({ error: 'No API key provided' });
  }
  
  const keyData = apiKeys.get(apiKey);
  if (!keyData) {
    return res.json({ apiKey: apiKey, requests: 0, limit: 10 });
  }
  
  res.json({
    apiKey: apiKey,
    requests: keyData.requests,
    limit: 10,
    resetAt: keyData.resetDate + ' 00:00 UTC'
  });
});

// ========================================
// SKILL EXTRACTION
// ========================================

const SKILL_PATTERNS = {
  languages: ['python', 'javascript', 'typescript', 'go', 'rust', 'java', 'c\\+\\+', 'ruby', 'php', 'swift', 'kotlin'],
  frontend: ['react', 'vue', 'angular', 'next\\.js', 'nextjs', 'tailwind', 'css', 'html', 'svelte', 'nuxt'],
  backend: ['node\\.js', 'nodejs', 'express', 'fastapi', 'django', 'flask', 'spring', 'rails', 'laravel'],
  ai_ml: ['openai', 'claude', 'gpt', 'langchain', 'llamaindex', 'llama', 'tensorflow', 'pytorch', 'pytorch', 'machine learning', 'ai', 'llm', 'gemma', 'mistral'],
  cloud: ['aws', 'gcp', 'azure', 'vercel', 'railway', 'docker', 'kubernetes', 'k8s', 'cloudflare'],
  databases: ['postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'supabase', 'firebase', 'dynamodb', 'sql'],
  tools: ['git', 'github', 'gitlab', 'vscode', 'cursor', 'figma', 'notion', 'slack', 'stripe']
};

function extractSkills(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const foundSkills = new Set();
  
  for (const [category, patterns] of Object.entries(SKILL_PATTERNS)) {
    for (const pattern of patterns) {
      const regex = new RegExp('\\b' + pattern + '\\b', 'i');
      if (regex.test(text)) {
        // Normalize skill name
        let skill = pattern.replace('\\.', '.').replace('\\+', '+');
        if (skill === 'nodejs') skill = 'node.js';
        if (skill === 'nextjs') skill = 'next.js';
        if (skill === 'postgres') skill = 'postgresql';
        if (skill === 'k8s') skill = 'kubernetes';
        foundSkills.add(skill);
      }
    }
  }
  
  return Array.from(foundSkills);
}

// ========================================
// FREE ENDPOINTS (No payment required)
// ========================================

// Home - API info
app.get('/', function(req, res) {
  res.json({
    name: 'AgentLeads API',
    version: '2.0.0',
    description: 'Aggregated opportunities + verification for AI agents',
    endpoints: {
      free: ['GET /', 'GET /health', 'GET /pricing', 'GET /stats'],
      paid: {
        leads: ['GET /opportunities', 'GET /opportunities/search'],
        verification: ['GET /verify/url', 'GET /verify/wallet', 'GET /verify/poster']
      }
    },
    pricing: {
      amount: PRICE,
      currency: 'USDC',
      network: 'Base',
      protocol: 'x402'
    }
  });
});

// Health check
app.get('/health', function(req, res) {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString() 
  });
});

// Pricing info
app.get('/pricing', function(req, res) {
  res.json({
    protocol: 'x402',
    recipient: WALLET,
    tiers: {
      basic: {
        description: 'Standard opportunity feed',
        endpoints: {
          '/opportunities': { price: '0.05', currency: 'USDC' },
          '/opportunities/search': { price: '0.05', currency: 'USDC' }
        }
      },
      premium: {
        description: 'Verified opportunities from trusted posters only',
        endpoints: {
          '/opportunities/verified': { price: '0.10', currency: 'USDC' },
          '/posters/top': { price: '0.05', currency: 'USDC' },
          '/posters/:author': { price: '0.10', currency: 'USDC' }
        }
      },
      verification: {
        description: 'Verify URLs, wallets, and poster reputation',
        endpoints: {
          '/verify/url': { price: '0.02', currency: 'USDC' },
          '/verify/wallet': { price: '0.05', currency: 'USDC' },
          '/verify/poster': { price: '0.05', currency: 'USDC' }
        }
      },
      featured: {
        description: 'Pin your listing at the top of the feed for 24-72 hours',
        endpoints: {
          'POST /feature': { price: '0.50', currency: 'USDC', note: 'per 24h slot, max 72h' }
        }
      }
    },
    free: ['/', '/health', '/stats', '/stats/completions', '/pricing', '/opportunities/featured', '/skills'],
    network: 'Base',
    documentation: 'https://docs.cdp.coinbase.com/x402',
    apiKey: {
      header: 'x-api-key',
      free: '10 requests per day',
      getKey: 'Visit https://agentleads.ai to sign up'
    }
  });
});

// Stats
app.get('/stats', function(req, res) {
  var stats = getStats();
  var featured = getFeaturedStats();
  res.json({
    totalOpportunities: stats.total,
    bySource: stats.bySource,
    lastUpdated: stats.lastScrape,
    featuredListings: featured.active
  });
});

// Validate a single URL (returns 200, 404, etc.)
app.get('/validate', function(req, res) {
  var url = req.query.url;
  if (!url) return res.json({ success: false, error: 'URL required' });
  
  var timeout = parseInt(req.query.timeout) || 5000;
  
  var parsedUrl;
  try { parsedUrl = new URL(url); } 
  catch (e) { return res.json({ success: false, error: 'Invalid URL' }); }
  
  var reqOptions = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'HEAD',
    timeout: timeout
  };
  
  var http = parsedUrl.protocol === 'https:' ? require('https') : require('http');
  
  var req = http.request(reqOptions, function(r) {
    res.json({ success: true, url: url, status: r.statusCode, valid: r.statusCode < 400 });
  });
  
  req.on('error', function(e) {
    res.json({ success: false, url: url, error: e.message, valid: false });
  });
  
  req.on('timeout', function() {
    req.destroy();
    res.json({ success: false, url: url, error: 'Timeout', valid: false });
  });
  
  req.end();
});

// Trigger scrape manually (for admin)
app.post('/scrape', async function(req, res) {
  // In production, add authentication
  try {
    var results = await runAllScrapers();
    res.json({ success: true, results: results });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Get available skills (extracted from all jobs)
app.get('/skills', function(req, res) {
  var opportunities = getRecentOpportunities(500, null, null);
  var allSkills = new Map();
  
  opportunities.forEach(function(opp) {
    var skills = extractSkills(opp.title, opp.description);
    skills.forEach(function(skill) {
      allSkills.set(skill.toLowerCase(), (allSkills.get(skill.toLowerCase()) || 0) + 1);
    });
  });
  
  // Sort by count
  var sortedSkills = Array.from(allSkills.entries())
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 50);
  
  res.json({
    success: true,
    count: sortedSkills.length,
    skills: sortedSkills.map(function(s) { return { name: s[0], count: s[1] }; })
  });
});

// ========================================
// PAYMENT MIDDLEWARE
// ========================================

function checkPayment(req, res, next) {
  var paymentHeader = req.headers['x-payment'];
  
  // For development: allow access without payment
  if (process.env.NODE_ENV === 'development') {
    console.log('[DEV MODE] Bypassing payment check');
    return next();
  }
  
  // For production: require x402 payment
  if (!paymentHeader) {
    return res.status(402).json({
      error: 'Payment Required',
      price: PRICE,
      currency: 'USDC',
      network: 'Base',
      recipient: WALLET,
      protocol: 'x402',
      message: 'Include x402 payment header to access this endpoint'
    });
  }
  
  // TODO: Verify payment with x402 SDK
  next();
}

// ========================================
// LEAD FEED ENDPOINTS (API Key or Payment Required)
// ========================================

// Get opportunities (featured listings always appear first)
// Uses API key check which falls back to payment check
app.get('/opportunities', checkApiKey, function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  var source = req.query.source || null;
  var category = req.query.category || null;
  var skills = req.query.skills ? req.query.skills.split(',') : null;
  
  // Get featured listings and pin them first
  var featured = getActiveFeaturedListings().map(function(opp) {
    var extractedSkills = extractSkills(opp.title, opp.description);
    return {
      id: opp.id,
      source: opp.source,
      title: opp.title,
      description: opp.description,
      payout: opp.payout,
      payoutCurrency: opp.payout_currency,
      author: opp.author,
      url: opp.post_url,
      category: opp.category,
      status: opp.status,
      scrapedAt: opp.paid_at,
      skills: extractedSkills,
      featured: true,
      featuredUntil: opp.expires_at
    };
  });

  // Filter featured by skills if provided
  if (skills && skills.length > 0) {
    featured = featured.filter(function(opp) {
      if (!opp.skills || opp.skills.length === 0) return false;
      return skills.some(function(skill) {
        return opp.skills.some(function(jobSkill) {
          return jobSkill.toLowerCase() === skill.toLowerCase().trim();
        });
      });
    });
  }
  
  var featuredUrls = featured.map(function(f) { return f.url; });
  
  var opportunities = getRecentOpportunities(500, source, category)
    .filter(function(opp) { return featuredUrls.indexOf(opp.post_url) === -1; })
    .map(function(opp) {
      var extractedSkills = extractSkills(opp.title, opp.description);
      return {
        id: opp.id,
        source: opp.source,
        title: opp.title,
        description: opp.description,
        payout: opp.payout,
        payoutCurrency: opp.payout_currency,
        author: opp.author,
        url: opp.post_url,
        category: opp.category,
        status: opp.status,
        scrapedAt: opp.scraped_at,
        skills: extractedSkills,
        featured: false
      };
    });
  
  // Filter by skills if provided
  if (skills && skills.length > 0) {
    opportunities = opportunities.filter(function(opp) {
      if (!opp.skills || opp.skills.length === 0) return false;
      return skills.some(function(skill) {
        return opp.skills.some(function(jobSkill) {
          return jobSkill.toLowerCase() === skill.toLowerCase().trim();
        });
      });
    });
  }
  
  var combined = featured.concat(opportunities).slice(0, limit);
  
  res.json({
    success: true,
    count: combined.length,
    featuredCount: featured.length,
    filters: {
      skills: skills,
      source: source,
      category: category
    },
    timestamp: new Date().toISOString(),
    data: combined
  });
});

// Search opportunities - REAL-TIME FETCHING
app.get('/opportunities/search', checkApiKey, async function(req, res) {
  var query = req.query.q || '';
  var limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  var minPayout = parseFloat(req.query.minPayout) || 0;
  var skills = req.query.skills ? req.query.skills.split(',') : null;
  var source = req.query.source || null;
  var realtime = req.query.realtime === 'true';
  
  // Fetch real-time from sources (default) or use cached DB
  var opportunities;
  if (realtime || !req.query.realtime) {
    // Real-time by default for freshness
    try {
      opportunities = await fetchAllSourcesRealTime(200);
      console.log(`[Search] Real-time fetch: ${opportunities.length} jobs`);
    } catch(e) {
      console.error('[Search] Real-time fetch failed, falling back to DB:', e.message);
      opportunities = getRecentOpportunities(200, null, null);
    }
  } else {
    // Use cached DB
    opportunities = getRecentOpportunities(200, null, null);
  }
  
  // Filter by source if specified
  if (source) {
    opportunities = opportunities.filter(function(opp) {
      return opp.source === source;
    });
  }
  
  if (query) {
    var searchTerm = query.toLowerCase();
    opportunities = opportunities.filter(function(opp) {
      return (opp.title && opp.title.toLowerCase().includes(searchTerm)) ||
             (opp.description && opp.description.toLowerCase().includes(searchTerm));
    });
  }
  
  if (minPayout > 0) {
    opportunities = opportunities.filter(function(opp) {
      return parseFloat(opp.payout) >= minPayout;
    });
  }
  
  opportunities = opportunities.slice(0, limit).map(function(opp) {
    var extractedSkills = extractSkills(opp.title, opp.description);
    return {
      id: opp.id,
      source: opp.source,
      title: opp.title,
      description: opp.description,
      payout: opp.payout,
      payoutCurrency: opp.payout_currency || opp.currency,
      author: opp.author,
      url: opp.url || opp.post_url,
      category: opp.category,
      status: opp.status,
      scrapedAt: opp.scraped_at,
      skills: extractedSkills
    };
  });
  
  // Filter by skills if provided
  if (skills && skills.length > 0) {
    opportunities = opportunities.filter(function(opp) {
      if (!opp.skills || opp.skills.length === 0) return false;
      return skills.some(function(skill) {
        return opp.skills.some(function(jobSkill) {
          return jobSkill.toLowerCase() === skill.toLowerCase().trim();
        });
      });
    });
  }
  
  res.json({
    success: true,
    query: query,
    filters: {
      skills: skills,
      minPayout: minPayout
    },
    count: opportunities.length,
    data: opportunities
  });
});

// ========================================
// FEATURED LISTINGS ENDPOINTS
// ========================================

// Get active featured listings (FREE — agents can browse without paying)
app.get('/opportunities/featured', function(req, res) {
  var featured = getActiveFeaturedListings().map(function(opp) {
    return {
      id: opp.id,
      source: opp.source,
      title: opp.title,
      description: opp.description,
      payout: opp.payout,
      payoutCurrency: opp.payout_currency,
      author: opp.author,
      url: opp.post_url,
      category: opp.category,
      status: opp.status,
      featured: true,
      featuredUntil: opp.expires_at
    };
  });
  
  res.json({
    success: true,
    count: featured.length,
    message: featured.length === 0 ? 'No featured listings currently active' : null,
    timestamp: new Date().toISOString(),
    data: featured
  });
});

// Feature a listing (poster pays to pin their job at top of feed)
app.post('/feature', checkPayment, function(req, res) {
  var postUrl = req.body.post_url || req.body.url;
  var title = req.body.title;
  var author = req.body.author || '';
  var source = req.body.source || '';
  var durationHours = Math.min(parseInt(req.body.duration_hours) || 24, 72); // max 72h
  
  if (!postUrl || !title) {
    return res.status(400).json({ 
      error: 'Missing required fields: post_url, title' 
    });
  }
  
  try {
    addFeaturedListing(postUrl, title, author, source, FEATURED_PRICE, durationHours);
    
    var expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
    
    res.json({
      success: true,
      message: 'Listing featured successfully',
      post_url: postUrl,
      title: title,
      featuredFor: durationHours + ' hours',
      expiresAt: expiresAt,
      pricePaid: FEATURED_PRICE + ' USDC',
      note: 'Your listing will appear at the top of /opportunities and /opportunities/featured'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// VERIFICATION ENDPOINTS (Paid)
// ========================================

// Verify if a URL is live and responding
app.get('/verify/url', checkPayment, async function(req, res) {
  var url = req.query.url;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    var startTime = Date.now();
    
    var response = await axios.get(url, {
      timeout: 10000,
      validateStatus: function() { return true; },
      headers: { 'User-Agent': 'AgentLeads-Verifier/1.0' }
    });
    
    var responseTime = Date.now() - startTime;
    
    res.json({
      success: true,
      url: url,
      status: response.status,
      alive: response.status >= 200 && response.status < 400,
      responseTimeMs: responseTime,
      contentType: response.headers['content-type'] || 'unknown',
      checkedAt: new Date().toISOString()
    });
    
  } catch (error) {
    res.json({
      success: true,
      url: url,
      alive: false,
      error: error.message,
      checkedAt: new Date().toISOString()
    });
  }
});

// Verify if a wallet has ETH balance on Base
app.get('/verify/wallet', checkPayment, async function(req, res) {
  var wallet = req.query.address;
  
  if (!wallet) {
    return res.status(400).json({ error: 'Missing address parameter' });
  }
  
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }
  
  try {
    var response = await axios.post('https://mainnet.base.org', {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [wallet, 'latest']
    });
    
    var balanceWei = parseInt(response.data.result, 16);
    var balanceEth = balanceWei / 1e18;
    
    res.json({
      success: true,
      address: wallet,
      network: 'Base',
      balanceWei: balanceWei.toString(),
      balanceEth: balanceEth.toFixed(6),
      hasBalance: balanceEth > 0,
      riskLevel: balanceEth > 0.01 ? 'low' : balanceEth > 0 ? 'medium' : 'high',
      checkedAt: new Date().toISOString()
    });
    
  } catch (error) {
    res.json({
      success: false,
      address: wallet,
      error: error.message,
      checkedAt: new Date().toISOString()
    });
  }
});

// Check wallet payment history (PREMIUM)
app.get('/verify/wallet-history', checkPayment, async function(req, res) {
  const wallet = req.query.address || req.query.wallet;
  
  if (!wallet) {
    return res.status(400).json({ error: 'Wallet address required. Use ?address=0x...' });
  }
  
  try {
    const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY;
    
    // Get transaction list from BaseScan
    const response = await axios.get('https://api.basescan.org/api', {
      params: {
        module: 'account',
        action: 'txlist',
        address: wallet,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: 100,
        sort: 'desc',
        apikey: BASESCAN_API_KEY
      }
    });
    
    const txs = response.data.result || [];
    
    // Filter for outgoing transfers (payments to other wallets)
    const outgoingTxs = txs.filter(tx => 
      tx.from.toLowerCase() === wallet.toLowerCase() && 
      parseFloat(tx.value) > 0
    );
    
    // Calculate totals
    const totalPaid = outgoingTxs.reduce((sum, tx) => sum + parseFloat(tx.value) / 1e18, 0);
    const paymentCount = outgoingTxs.length;
    const avgPayment = paymentCount > 0 ? totalPaid / paymentCount : 0;
    
    // Get last payment date
    const lastPayment = outgoingTxs[0] ? new Date(parseInt(outgoingTxs[0].timeStamp) * 1000).toISOString() : null;
    
    // Build payment history (last 10)
    const paymentHistory = outgoingTxs.slice(0, 10).map(tx => ({
      amount_eth: (parseFloat(tx.value) / 1e18).toFixed(4),
      to: tx.to,
      date: new Date(parseInt(tx.timeStamp) * 1000).toISOString().split('T')[0],
      hash: tx.hash,
      confirmations: tx.confirmations
    }));
    
    res.json({
      success: true,
      address: wallet,
      network: 'Base',
      summary: {
        total_paid_eth: totalPaid.toFixed(4),
        payment_count: paymentCount,
        avg_payment_eth: avgPayment.toFixed(4),
        last_payment: lastPayment
      },
      payment_history: paymentHistory,
      checkedAt: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      address: wallet,
      error: error.message,
      checkedAt: new Date().toISOString()
    });
  }
});

// Check poster reputation based on database
app.get('/verify/poster', checkPayment, function(req, res) {
  var posterId = req.query.id;
  
  if (!posterId) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }
  
  var stmt = db.prepare('SELECT COUNT(*) as count, source FROM opportunities WHERE author = ? GROUP BY source');
  var results = stmt.all(posterId);
  
  var totalPosts = results.reduce(function(sum, r) { return sum + r.count; }, 0);
  
  var reputation = 'unknown';
  if (totalPosts > 10) reputation = 'established';
  else if (totalPosts > 3) reputation = 'active';
  else if (totalPosts > 0) reputation = 'new';
  
  res.json({
    success: true,
    posterId: posterId,
    totalPosts: totalPosts,
    bySource: results,
    reputation: reputation,
    trustScore: Math.min(100, totalPosts * 10),
    checkedAt: new Date().toISOString()
  });
});
// ========================================
// PREMIUM ENDPOINTS (Higher price, verified data)
// ========================================

// Get verified opportunities (only from trusted posters)
app.get('/opportunities/verified', checkPayment, function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 50, 100);
  var minScore = parseInt(req.query.minScore) || 70;
  
  var { getVerifiedOpportunities } = require('./utils/database');
  var opportunities = getVerifiedOpportunities(limit, minScore);
  
  opportunities = opportunities.map(function(opp) {
    return {
      id: opp.id,
      source: opp.source,
      title: opp.title,
      description: opp.description,
      payout: opp.payout,
      payoutCurrency: opp.payout_currency,
      author: opp.author,
      url: opp.post_url,
      category: opp.category,
      status: opp.status,
      scrapedAt: opp.scraped_at,
      posterReputation: opp.reputation_score || 50,
      posterPaidCount: opp.total_paid || 0,
      posterTotalCount: opp.total_posted || 0
    };
  });
  
  res.json({
    success: true,
    tier: 'verified',
    minReputationScore: minScore,
    count: opportunities.length,
    timestamp: new Date().toISOString(),
    data: opportunities
  });
});

// Get top trusted posters
app.get('/posters/top', checkPayment, function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 50);
  
  var { getTopPosters } = require('./utils/database');
  var posters = getTopPosters(limit);
  
  res.json({
    success: true,
    count: posters.length,
    data: posters.map(function(p) {
      return {
        author: p.author,
        source: p.source,
        reputationScore: p.reputation_score,
        totalPosted: p.total_posted,
        totalCompleted: p.total_completed,
        totalPaid: p.total_paid,
        paymentRate: p.total_completed > 0 ? Math.round((p.total_paid / p.total_completed) * 100) + '%' : 'N/A'
      };
    })
  });
});

// Get detailed poster reputation
app.get('/posters/:author', checkPayment, function(req, res) {
  var author = req.params.author;
  
  var { getPosterReputation, db } = require('./utils/database');
  var reputation = getPosterReputation(author);
  
  // Get recent opportunities from this poster
  var recentOpps = db.prepare(`
    SELECT title, payout, status, scraped_at 
    FROM opportunities 
    WHERE author = ? 
    ORDER BY scraped_at DESC 
    LIMIT 10
  `).all(author);
  
  if (!reputation) {
    return res.json({
      success: true,
      author: author,
      reputation: 'unknown',
      message: 'No data available for this poster'
    });
  }
  
  res.json({
    success: true,
    author: author,
    reputationScore: reputation.reputation_score,
    trustLevel: reputation.reputation_score >= 80 ? 'high' : reputation.reputation_score >= 50 ? 'medium' : 'low',
    stats: {
      totalPosted: reputation.total_posted,
      totalCompleted: reputation.total_completed,
      totalPaid: reputation.total_paid,
      totalUnpaid: reputation.total_unpaid,
      paymentRate: reputation.total_completed > 0 ? Math.round((reputation.total_paid / reputation.total_completed) * 100) + '%' : 'N/A'
    },
    recentOpportunities: recentOpps,
    lastUpdated: reputation.last_updated
  });
});

// Completion stats endpoint (free)
app.get('/stats/completions', function(req, res) {
  var { getCompletionStats, getTopPosters } = require('./utils/database');
  var stats = getCompletionStats();
  var topPosters = getTopPosters(5);
  
  res.json({
    success: true,
    completionTracking: stats,
    topTrustedPosters: topPosters.map(function(p) {
      return { author: p.author, score: p.reputation_score, paid: p.total_paid };
    }),
    message: 'Completion tracking is active. Reputation scores update as bounties are completed.'
  });
});
// ========================================
// ADMIN ENDPOINTS
// ========================================

app.post('/admin/scrape', function(req, res) {
  console.log('Manual scrape triggered...');
  runAllScrapers()
    .then(function(result) {
      res.json({ success: true, result: result });
    })
    .catch(function(err) {
      res.status(500).json({ success: false, error: err.message });
    });
});

// ========================================
// SCHEDULED SCRAPING
// ========================================

cron.schedule('*/30 * * * *', function() {
  console.log('\n[CRON] Running scheduled scrape (non-API sources)...');
  runAllScrapers().catch(function(err) {
    console.error('[CRON] Scrape failed:', err.message);
  });
});
  // Run completion checker every hour
cron.schedule('0 * * * *', function() {
  console.log('Running hourly completion check...');
  var { runCompletionCheck } = require('./completion-checker');
  runCompletionCheck().catch(function(err) {
    console.error('Completion check error:', err.message);
  });
});

// ========================================
// START SERVER
// ========================================

// Email subscription endpoint (free - no payment required)
app.post('/subscribe', function(req, res) {
  var email = req.body.email;
  
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }
  
  // Simple email validation
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format' });
  }
  
  var skills = req.body.skills || '';
  
  var result = addSubscriber(email, skills);
  
  if (result.success) {
    res.json({ success: true, message: 'Subscribed successfully!' });
  } else {
    res.status(400).json({ success: false, error: result.error || 'Already subscribed' });
  }
});

// Get subscriber count (for admin/debugging)
app.get('/subscribers/count', function(req, res) {
  var count = getSubscriberCount();
  res.json({ success: true, count: count });
});

app.listen(PORT, function() {
  console.log('\n========================================');
  console.log('  AGENTLEADS API SERVER v2.0');
  console.log('========================================');
  console.log('  Port: ' + PORT);
  console.log('  Mode: ' + (process.env.NODE_ENV || 'development'));
  console.log('  Wallet: ' + WALLET);
  console.log('========================================');
  console.log('  LEAD FEED ENDPOINTS:');
  console.log('    GET  /opportunities       $0.05');
  console.log('    GET  /opportunities/search $0.05');
  console.log('  VERIFICATION ENDPOINTS:');
  console.log('    GET  /verify/url          $0.02');
  console.log('    GET  /verify/wallet       $0.05');
  console.log('    GET  /verify/wallet-history $0.05');
  console.log('    GET  /verify/poster       $0.05');
  console.log('  FREE ENDPOINTS:');
  console.log('    GET  /  /health  /pricing  /stats');
  console.log('========================================\n');
  
  console.log('Running initial scrape...\n');
  runAllScrapers().catch(function(err) {
    console.error('Initial scrape failed:', err.message);
  });
});
