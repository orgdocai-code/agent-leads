require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const { getRecentOpportunities, getStats, db, addFeaturedListing, getActiveFeaturedListings, getFeaturedStats } = require('./utils/database');
const { runAllScrapers } = require('./scraper-runner');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WALLET = process.env.WALLET_ADDRESS || '0xYourWalletHere';
const PRICE = process.env.PRICE_PER_REQUEST || '0.05';
const FEATURED_PRICE = process.env.FEATURED_PRICE || '0.50';

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
    free: ['/', '/health', '/stats', '/stats/completions', '/pricing', '/opportunities/featured'],
    network: 'Base',
    documentation: 'https://docs.cdp.coinbase.com/x402'
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
// LEAD FEED ENDPOINTS (Paid)
// ========================================

// Get opportunities (featured listings always appear first)
app.get('/opportunities', checkPayment, function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 50, 100);
  var source = req.query.source || null;
  var category = req.query.category || null;
  
  // Get featured listings and pin them first
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
      scrapedAt: opp.paid_at,
      featured: true,
      featuredUntil: opp.expires_at
    };
  });

  var featuredUrls = featured.map(function(f) { return f.url; });
  
  var opportunities = getRecentOpportunities(limit, source, category)
    .filter(function(opp) { return featuredUrls.indexOf(opp.post_url) === -1; })
    .map(function(opp) {
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
        featured: false
      };
    });
  
  var combined = featured.concat(opportunities).slice(0, limit);
  
  res.json({
    success: true,
    count: combined.length,
    featuredCount: featured.length,
    timestamp: new Date().toISOString(),
    data: combined
  });
});

// Search opportunities
app.get('/opportunities/search', checkPayment, function(req, res) {
  var query = req.query.q || '';
  var limit = Math.min(parseInt(req.query.limit) || 50, 100);
  var minPayout = parseFloat(req.query.minPayout) || 0;
  
  var opportunities = getRecentOpportunities(200, null, null);
  
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
      scrapedAt: opp.scraped_at
    };
  });
  
  res.json({
    success: true,
    query: query,
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

cron.schedule('*/10 * * * *', function() {
  console.log('\n[CRON] Running scheduled scrape...');
  runAllScrapers().catch(function(err) {
    console.error('[CRON] Scrape failed:', err.message);
  });
  // Run completion checker every hour
cron.schedule('0 * * * *', function() {
  console.log('Running hourly completion check...');
  var { runCompletionCheck } = require('./completion-checker');
  runCompletionCheck().catch(function(err) {
    console.error('Completion check error:', err.message);
  });
});
});

// ========================================
// START SERVER
// ========================================

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
