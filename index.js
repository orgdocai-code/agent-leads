// Railway deployment - full server with built-in scraper scheduler
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const { getRecentOpportunities, getStats, db, addFeaturedListing, getActiveFeaturedListings, getFeaturedStats, addSubscriber, getSubscribers, getSubscriberCount } = require('./src/utils/database');
const { runAllScrapers } = require('./src/scraper-runner');
const { initX402 } = require('./src/utils/payment-router');
const { autobidder, searchBountyIssues, createSolutionPR, parseSolutionX402 } = require('./src/utils/autobidder-v3');

const app = express();
app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
  res.json({ 
    name: 'AgentLeads API', 
    version: '1.0.0',
    endpoints: ['/health', '/jobs', '/stats', '/skills', '/scrape']
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all jobs
app.get('/jobs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const jobs = getRecentOpportunities(limit);
    res.json({ jobs, count: jobs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search opportunities (for UI)
app.get('/opportunities/search', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;
    const skills = req.query.skills ? req.query.skills.split(',') : [];
    const query = req.query.q || '';
    
    let jobs = getRecentOpportunities(limit);
    
    // Filter by skills
    if (skills.length > 0) {
      jobs = jobs.filter(job => {
        const jobSkills = (job.required_skills || []).map(s => s.toLowerCase());
        return skills.some(s => jobSkills.includes(s.toLowerCase()));
      });
    }
    
    // Filter by query
    if (query) {
      const q = query.toLowerCase();
      jobs = jobs.filter(job => 
        job.title.toLowerCase().includes(q) || 
        (job.description && job.description.toLowerCase().includes(q))
      );
    }
    
    // Format for UI (ensure all fields match expected structure)
    const formattedJobs = jobs.map(job => ({
      id: job.id,
      source: job.source,
      title: job.title,
      description: job.description || '',
      payout: job.payout || '',
      payoutCurrency: job.payout_currency || 'USD',
      author: job.author || '',
      url: job.post_url || job.url || '',
      category: job.category || '',
      status: job.status || 'active',
      scrapedAt: job.scraped_at || job.created_at || new Date().toISOString(),
      skills: job.required_skills || [],
      featured: false
    }));
    
    res.json({ data: formattedJobs, count: formattedJobs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get stats
app.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger scrape manually (for admin)
app.post('/scrape', async (req, res) => {
  try {
    const results = await runAllScrapers();
    res.json({ success: true, results: results });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Add featured listing
app.post('/featured', (req, res) => {
  try {
    const { title, company, url, description } = req.body;
    const listing = addFeaturedListing({ title, company, url, description });
    res.json({ success: true, listing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get featured listings
app.get('/featured', (req, res) => {
  try {
    const listings = getActiveFeaturedListings();
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subscribe
app.post('/subscribe', (req, res) => {
  try {
    const { email } = req.body;
    addSubscriber(email);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get subscriber count
app.get('/subscribers/count', (req, res) => {
  try {
    const count = getSubscriberCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// BUILT-IN SCRAPER SCHEDULER
// ========================================
console.log('[Scheduler] Setting up scraper cron job (every 2 hours)');

// Run scraper every 2 hours
cron.schedule('0 */2 * * *', async () => {
  console.log('[Scheduler] Running scheduled scraper...');
  try {
    const results = await runAllScrapers();
    console.log('[Scheduler] Scraping complete:', results);
  } catch (e) {
    console.error('[Scheduler] Scraping error:', e.message);
  }
});

// Initial scrape on startup (after 10 second delay)
setTimeout(async () => {
  console.log('[Startup] Running initial scrape...');
  try {
    const results = await runAllScrapers();
    console.log('[Startup] Initial scrape complete:', results);
  } catch (e) {
    console.error('[Startup] Initial scrape error:', e.message);
  }
}, 10000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgentLeads API running on port ${PORT}`);
});
