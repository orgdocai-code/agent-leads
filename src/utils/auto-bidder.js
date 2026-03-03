// Auto-Bidder: Finds high-paying jobs and generates proposals
// Phase 2: AI-Powered proposal generation

const axios = require('axios');
const { generator } = require('./proposal-ai');

// Minimum payout to consider (in USDC)
const MIN_PAYOUT = 50;

// Poll interval (ms)
const POLL_INTERVAL = 60000; // 1 minute

// Known bounty APIs
const BOUNTY_SOURCES = {
  owockibot: {
    name: 'Owockibot',
    url: 'https://bounty.owockibot.xyz/bounties',
    parser: (bounty) => ({
      id: bounty.id,
      source: 'owockibot',
      title: bounty.title,
      description: bounty.description,
      payout: parseFloat(bounty.reward || 0) / 1000000,
      currency: 'USDC',
      status: bounty.status,
      url: `https://bounty.owockibot.xyz/bounty/${bounty.id}`,
      tags: bounty.tags || [],
      createdAt: bounty.createdAt,
      deadline: bounty.deadline
    })
  }
};

// Database for storing proposals
let proposals = [];

// Initialize auto-bidder
function initAutoBidder(app) {
  console.log('[AutoBidder] Initializing...');
  
  // Start polling
  startPolling();
  
  // API endpoints
  app.get('/autobid/status', function(req, res) {
    res.json({
      running: true,
      proposalsCount: proposals.length,
      lastPoll: lastPollTime,
      minPayout: MIN_PAYOUT
    });
  });
  
  app.get('/autobid/proposals', function(req, res) {
    res.json({ proposals: proposals.slice(-50) });
  });
  
  app.post('/autobid/poll', async function(req, res) {
    try {
      const results = await pollAllSources();
      res.json({ success: true, found: results.length, proposals: results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  
  app.post('/autobid/generate/:jobId', async function(req, res) {
    try {
      const jobId = req.params.jobId;
      const proposal = await generateProposal(jobId);
      res.json({ success: true, proposal });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  
  console.log('[AutoBidder] Ready');
}

let lastPollTime = null;

// Poll all known sources
async function pollAllSources() {
  const newJobs = [];
  
  for (const [key, source] of Object.entries(BOUNTY_SOURCES)) {
    try {
      console.log(`[AutoBidder] Polling ${source.name}...`);
      const response = await axios.get(source.url, { timeout: 10000 });
      const bounties = response.data || [];
      
      for (const bounty of bounties) {
        const parsed = source.parser(bounty);
        
        // Check if meets criteria
        if (parsed.status !== 'open') continue;
        if (parsed.payout < MIN_PAYOUT) continue;
        
        // Check if already have proposal
        const exists = proposals.find(p => p.jobId === parsed.id && p.source === key);
        if (exists) continue;
        
        // Check if we can do it
        const canDo = checkCapabilityMatch(parsed);
        
        if (canDo && canDo.canDo) {
          const proposal = {
            id: Date.now(),
            jobId: parsed.id,
            source: key,
            job: parsed,
            canDo: true,
            matchScore: canDo.score,
            matchReason: canDo.capabilities,
            generatedAt: new Date().toISOString(),
            proposal: null,
            status: 'pending'
          };
          
          proposals.push(proposal);
          newJobs.push(proposal);
          console.log(`[AutoBidder] Found: ${parsed.title} - $${parsed.payout} (score: ${canDo.score})`);
        }
      }
    } catch (e) {
      console.error(`[AutoBidder] Error polling ${source.name}:`, e.message);
    }
  }
  
  lastPollTime = new Date();
  return newJobs;
}

// Check if we can do this job using AI analysis
function checkCapabilityMatch(job) {
  const analysis = generator.analyzeJob(job);
  if (analysis.canBid) {
    return { canDo: true, score: analysis.score, capabilities: analysis.capabilities.map(c => c.name).join(', ') };
  }
  return null;
}

// Generate proposal using AI
async function generateProposal(jobId) {
  const proposal = proposals.find(p => p.jobId === jobId);
  if (!proposal) {
    throw new Error('Proposal not found');
  }
  
  // Use AI generator
  const analysis = generator.analyzeJob(proposal.job);
  const aiProposal = await generator.generateProposal(proposal.job, analysis);
  
  // Update proposal
  proposal.proposal = generator.formatProposal(aiProposal);
  proposal.analysis = analysis;
  proposal.status = 'generated';
  proposal.generatedAt = new Date().toISOString();
  
  console.log(`[AutoBidder] Generated proposal for job ${jobId} (score: ${analysis.score})`);
  
  return proposal;
}

// Start polling loop
function startPolling() {
  console.log(`[AutoBidder] Starting poll loop (every ${POLL_INTERVAL/1000}s)`);
  
  // Initial poll
  pollAllSources().catch(console.error);
  
  // Set interval
  setInterval(() => {
    pollAllSources().catch(console.error);
  }, POLL_INTERVAL);
}

module.exports = {
  initAutoBidder: initAutoBidder,
  pollAllSources: pollAllSources
};
