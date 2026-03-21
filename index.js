// Railway deployment - redirect to full server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const { getRecentOpportunities, getStats, db, addFeaturedListing, getActiveFeaturedListings, getFeaturedStats, addSubscriber, getSubscribers, getSubscriberCount } = require('./src/utils/database');
const { runAllScrapers } = require('./src/scraper-runner');
const { initX402 } = require('./src/utils/payment-router');
const { autobidder, searchBountyIssues, createSolutionPR, parseSolutionFiles } = require('./src/utils/autobidder-v3');

const app = express();
app.use(cors());
app.use(express.json());

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

// Get stats
app.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgentLeads API running on port ${PORT}`);
});
