// Auto-Bidder v2: Complete Job Matching System
// Polls from multiple sources, matches capabilities, generates proposals

const axios = require('axios');
const { generator } = require('./proposal-ai');

// Minimum payout (USDC)
const MIN_PAYOUT = 10;

// In-memory store
let proposals = [];
let lastPollTime = null;
let stats = { polls: 0, matches: 0, errors: 0 };

// Capability keywords
const CAPABILITY_KEYWORDS = {
  'api': ['api', 'rest', 'graphql', 'endpoint', 'backend'],
  'frontend': ['frontend', 'react', 'vue', 'nextjs', 'ui', 'interface'],
  'discord': ['discord', 'bot'],
  'telegram': ['telegram', 'bot'],
  'automation': ['automation', 'automate', 'workflow', 'script'],
  'ai': ['ai', 'llm', 'gpt', 'openai', 'anthropic', 'ml', 'machine learning'],
  'scraping': ['scrap', 'crawl', 'extract', 'parse'],
  'smart-contract': ['solidity', 'smart contract', 'evm', 'token'],
  'database': ['database', 'sql', 'postgres', 'mysql', 'sqlite'],
  'security': ['security', 'audit', 'penetration'],
  'mobile': ['ios', 'android', 'react native', 'flutter'],
  'devops': ['docker', 'kubernetes', 'aws', 'cloud', 'deploy']
};

class AutoBidder {
  constructor() {
    this.running = false;
  }
  
  // Initialize with Express app
  init(app) {
    // Endpoints
    app.get('/autobid/status', (req, res) => {
      res.json({
        running: this.running,
        stats,
        lastPoll: lastPollTime,
        proposalsCount: proposals.length,
        minPayout: MIN_PAYOUT
      });
    });
    
    app.get('/autobid/proposals', (req, res) => {
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status;
      
      let filtered = proposals;
      if (status) filtered = proposals.filter(p => p.status === status);
      
      res.json({ 
        proposals: filtered.slice(-limit),
        total: filtered.length
      });
    });
    
    app.get('/autobid/proposal/:id', (req, res) => {
      const id = parseInt(req.params.id);
      const proposal = proposals.find(p => p.id === id);
      
      if (!proposal) return res.status(404).json({ error: 'Not found' });
      res.json({ proposal });
    });
    
    app.post('/autobid/poll', async (req, res) => {
      try {
        const results = await this.pollAll();
        res.json({ success: true, found: results.length, results });
      } catch (e) {
        stats.errors++;
        res.status(500).json({ error: e.message });
      }
    });
    
    app.post('/autobid/generate/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const proposal = await this.generateProposal(id);
        res.json({ success: true, proposal });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    
    app.post('/autobid/start', (req, res) => {
      this.start();
      res.json({ success: true, running: true });
    });
    
    app.post('/autobid/stop', (req, res) => {
      this.stop();
      res.json({ success: true, running: false });
    });
    
    // Start auto-polling
    this.start();
    
    console.log('[AutoBidder] Initialized');
  }
  
  start() {
    if (this.running) return;
    this.running = true;
    
    // Initial poll
    this.pollAll().catch(console.error);
    
    // Poll every 60 seconds
    this.interval = setInterval(() => {
      this.pollAll().catch(console.error);
    }, 60000);
    
    console.log('[AutoBidder] Started');
  }
  
  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[AutoBidder] Stopped');
  }
  
  async pollAll() {
    console.log('[AutoBidder] Polling...');
    stats.pollsPro++;
    const newposals = [];
    
    try {
      // Fetch from our database via API
      const response = await axios.get(
        `https://agent-leads-production.up.railway.app/opportunities?limit=500`,
        { headers: { 'x-api-key': 'demo' }, timeout: 15000 }
      );
      
      const jobs = response.data.data || [];
      console.log(`[AutoBidder] Found ${jobs.length} jobs in database`);
      
      for (const job of jobs) {
        // Skip inactive
        if (job.status !== 'active') continue;
        
        // Check payout
        const payout = parseFloat(job.payout) || 0;
        if (payout < MIN_PAYOUT) continue;
        
        // Skip if already have proposal
        const exists = proposals.find(p => p.jobId === job.id && p.source === job.source);
        if (exists) continue;
        
        // Analyze capabilities
        const analysis = this.analyzeJob(job);
        
        if (analysis.canBid) {
          const proposal = {
            id: Date.now() + Math.random(),
            jobId: job.id,
            source: job.source,
            job: {
              id: job.id,
              title: job.title,
              description: job.description,
              payout: payout,
              currency: job.payoutCurrency,
              url: job.url,
              skills: job.skills || []
            },
            analysis,
            status: 'found',
            foundAt: new Date().toISOString(),
            proposalText: null,
            generatedAt: null
          };
          
          proposals.push(proposal);
          newProposals.push(proposal);
          stats.matches++;
          
          console.log(`[AutoBidder] MATCH: ${job.title.substring(0,40)} - $${payout} (score: ${analysis.score})`);
        }
      }
      
    } catch (e) {
      console.error('[AutoBidder] Poll error:', e.message);
      stats.errors++;
    }
    
    lastPollTime = new Date();
    return newProposals;
  }
  
  analyzeJob(job) {
    const text = `${job.title} ${job.description || ''} ${(job.skills || []).join(' ')}`.toLowerCase();
    
    let score = 0;
    const matchedCapabilities = [];
    const matchedKeywords = [];
    
    // Check each capability category
    for (const [capability, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          score += 2;
          if (!matchedCapabilities.includes(capability)) {
            matchedCapabilities.push(capability);
            matchedKeywords.push(keyword);
          }
          break;
        }
      }
    }
    
    // Bonus for high payout
    const payout = parseFloat(job.payout) || 0;
    if (payout > 100) score += 3;
    if (payout > 500) score += 5;
    
    return {
      canBid: score >= 3,
      score,
      capabilities: matchedCapabilities,
      keywords: matchedKeywords
    };
  }
  
  async generateProposal(id) {
    const proposal = proposals.find(p => p.id === id);
    if (!proposal) {
      throw new Error('Proposal not found');
    }
    
    if (proposal.proposalText) {
      return proposal; // Already generated
    }
    
    // Generate using AI
    const aiProposal = await generator.generateProposal(proposal.job, proposal.analysis);
    proposal.proposalText = generator.formatProposal(aiProposal);
    proposal.status = 'generated';
    proposal.generatedAt = new Date().toISOString();
    
    console.log(`[AutoBidder] Generated proposal for ${proposal.job.title}`);
    
    return proposal;
  }
}

const autobidder = new AutoBidder();

module.exports = {
  autobidder,
  AutoBidder
};
