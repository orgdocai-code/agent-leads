// Railway expects index.js in root - start the server from src
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const { getRecentOpportunities, getStats, db, addFeaturedListing, getActiveFeaturedListings, getFeaturedStats, addSubscriber, getSubscribers, getSubscriberCount } = require('./src/utils/database');
const { runAllScrapers } = require('./src/scraper-runner');
const { initX402 } = require('./src/utils/payment-router');
const { autobidder, searchBountyIssues, createSolutionPR, parseSolutionFiles } = require('./src/utils/autobidder-v3');

// ... copy the rest of server.js here
// Actually simpler: just run the server.js content directly

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all jobs
app.get('/jobs', (req, res) => {
  try {
    const jobs = getRecentOpportunities(100);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgentLeads API running on port ${PORT}`);
});
