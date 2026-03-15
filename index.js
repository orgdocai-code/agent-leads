// Minimal Railway deployment test
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all jobs - minimal version
app.get('/jobs', (req, res) => {
  res.json({ jobs: [], count: 0, message: 'Database not connected in minimal mode' });
});

// Get stats
app.get('/stats', (req, res) => {
  res.json({ total: 0, sources: 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgentLeads API running on port ${PORT}`);
});
