// Auto-Bidder v3: Multi-Source Polling
// Polls multiple bounty sources directly for better coverage

const axios = require('axios');
const { generator } = require('./proposal-ai');
const { saveProposal, getAgentProposals, getAgentByApiKey, registerAgent, getAgentStats, updateProposalStatus, db, getAllAgents, proposalExists } = require('./database');

const MIN_PAYOUT = 0.001;
let lastPollTime = null;
let stats = { polls: 0, matches: 0, errors: 0, bySource: {} };

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
  'devops': ['docker', 'kubernetes', 'aws', 'cloud', 'deploy'],
  'web': ['web', 'website', 'frontend', 'ui', 'ux'],
  'api': ['api', 'rest', 'graphql', 'endpoint', 'backend'],
  'javascript': ['javascript', 'js', 'node', 'nodejs'],
  'python': ['python', 'py'],
  'integration': ['integrat', 'connect', 'hook']
};

// Direct API sources - these bypass our scraper
const DIRECT_SOURCES = {
  // Our own database
  'agentleads': {
    name: 'AgentLeads DB',
    url: 'https://agent-leads-production.up.railway.app/opportunities?limit=500',
    headers: { 'x-api-key': 'demo' },
    parser: (job) => ({
      id: `al-${job.id}`,
      source: 'agentleads',
      sourceName: 'AgentLeads',
      title: job.title,
      description: job.description || '',
      payout: parseFloat(job.payout) || 0,
      currency: job.payoutCurrency || 'USDC',
      url: job.url,
      status: job.status,
      skills: job.skills || []
    })
  },
  
  // GitHub Issues with bounty labels
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
      payout: 0, // GitHub bounties vary - parse from title/body
      currency: 'varies',
      url: issue.html_url,
      status: 'open',
      skills: issue.labels?.map(l => l.name) || [],
      repo: issue.repository_url?.replace('https://api.github.com/repos/', '') || ''
    })
  },
  
  // Owockibot direct
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

class AutoBidderV3 {
  constructor() {
    this.running = false;
    this.notificationCallback = null;
  }
  
  init(app) {
    // REST endpoints
    app.get('/autobid/status', (req, res) => {
      res.json({
        running: this.running,
        stats,
        lastPoll: lastPollTime,
        minPayout: MIN_PAYOUT,
        sources: Object.keys(DIRECT_SOURCES)
      });
    });
    
    // Register new agent - returns API key
    app.post('/autobid/register', (req, res) => {
      try {
        const { name, capabilities } = req.body;
        const agent = registerAgent(name || 'Agent', capabilities || []);
        
        res.json({
          success: true,
          agent: {
            id: agent.id,
            name: agent.name,
            capabilities: agent.capabilities
          },
          api_key: agent.api_key,
          warning: "⚠️ SAVE THIS API KEY NOW! You cannot regenerate the same key or recover history. Store it safely."
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    
    // Get agent info by API key
    app.get('/autobid/me', (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      const agentStats = getAgentStats(agent.id);
      res.json({ agent, stats: agentStats });
    });
    
    // Get proposals for agent
    app.get('/autobid/proposals', (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      const status = req.query.status;
      const limit = parseInt(req.query.limit) || 50;
      
      const proposals = getAgentProposals(agent.id, status, limit);
      const agentStats = getAgentStats(agent.id);
      
      res.json({ 
        proposals,
        stats: agentStats,
        total: proposals.length
      });
    });
    
    // Update proposal status
    app.patch('/autobid/proposal/:id', (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: 'Status required' });
      
      updateProposalStatus(req.params.id, status);
      res.json({ success: true });
    });
    
    // Legacy endpoints (for backward compatibility)
    app.get('/autobid/proposal/:id', (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      const proposals = getAgentProposals(agent.id, null, 1000);
      const proposal = proposals.find(p => p.id == req.params.id);
      
      if (!proposal) return res.status(404).json({ error: 'Not found' });
      res.json({ proposal });
    });
    
    app.post('/autobid/poll', async (req, res) => {
      // Poll but don't auto-save (just return results)
      // Agents must explicitly save proposals they want
      try {
        const results = await this.pollAll(false);
        res.json({ success: true, found: results.length, results });
      } catch (e) {
        stats.errors++;
        res.status(500).json({ error: e.message });
      }
    });
    
    // Save a proposal for the agent
    app.post('/autobid/save', (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      const { job, analysis } = req.body;
      if (!job) return res.status(400).json({ error: 'Job data required' });
      
      const proposalId = saveProposal({
        agent_id: agent.id,
        job_id: job.id,
        source: job.source,
        source_name: job.sourceName,
        job_title: job.title,
        job_description: job.description,
        job_url: job.url,
        payout: job.payout,
        currency: job.currency,
        skills: job.skills || [],
        status: 'found',
        matched_at: new Date().toISOString()
      });
      
      stats.matches++;
      res.json({ success: true, proposalId });
    });
    
    app.post('/autobid/generate/:id', async (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      try {
        const proposal = await this.generateProposal(req.params.id, agent.id);
        res.json({ success: true, proposal });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    
    app.post('/autobid/start', (req, res) => { this.start(); res.json({ success: true }); });
    app.post('/autobid/stop', (req, res) => { this.stop(); res.json({ success: true }); });
    
    // Start auto-polling
    this.start();
    console.log('[AutoBidderV3] Initialized with DB storage');
  }
  
  start() {
    if (this.running) return;
    this.running = true;
    this.pollAll().catch(console.error);
    this.interval = setInterval(() => this.pollAll().catch(console.error), 60000);
    console.log('[AutoBidderV3] Started polling');
  }
  
  stop() {
    this.running = false;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }
  
  onMatch(callback) {
    this.notificationCallback = callback;
  }
  
  async pollAll() {
    console.log('[AutoBidderV3] Polling all sources...');
    stats.polls++;
    const newProposals = [];
    
    for (const [key, source] of Object.entries(DIRECT_SOURCES)) {
      try {
        if (!stats.bySource[key]) stats.bySource[key] = { polls: 0, matches: 0 };
        stats.bySource[key].polls++;
        
        const response = await axios.get(source.url, { 
          headers: source.headers, 
          timeout: 15000 
        }).catch(e => {
          console.error(`[AutoBidderV3] ${source.name} error:`, e.message);
          return { data: [] };
        });
        
        // Handle different API response formats
        let items = [];
        if (Array.isArray(response.data)) {
          items = response.data;
        } else if (response.data.items) {
          items = response.data.items;
        } else if (response.data.data) {
          items = response.data.data;
        }
        
        console.log(`[AutoBidderV3] ${source.name}: ${items.length} jobs`);
        
        for (const item of items) {
          const job = source.parser(item);
          
          // Skip closed/completed jobs
          if (job.status === 'closed' || job.status === 'completed') continue;
          // Skip if payout is 0 for non-GitHub sources (GitHub bounties vary)
          if (job.payout < MIN_PAYOUT && job.source !== 'github') continue;
          
          const exists = proposals.find(p => p.jobId === job.id && p.source === job.source);
          if (exists) continue;
          
          const analysis = this.analyzeJob(job);
          console.log(`[AutoBidderV3] Analyzed: ${job.title?.substring(0,30)} score=${analysis.score} canBid=${analysis.canBid}`);
          
          if (analysis.canBid) {
            const proposal = {
              id: Date.now() + Math.floor(Math.random() * 1000),
              jobId: job.id,
              source: job.source,
              sourceName: job.sourceName,
              job,
              analysis,
              status: 'found',
              foundAt: new Date().toISOString(),
              proposalText: null,
              generatedAt: null
            };
            
            proposals.push(proposal);
            newProposals.push(proposal);
            stats.matches++;
            stats.bySource[key].matches++;
            
            console.log(`[AutoBidderV3] ✓ MATCH: ${job.title.substring(0,40)} - $${job.payout} [${job.source}]`);
            
            // Notify
            if (this.notificationCallback) {
              this.notificationCallback(proposal);
            }
          }
        }
      } catch (e) {
        console.error(`[AutoBidderV3] Error polling ${source.name}:`, e.message);
        stats.errors++;
      }
    }
    
    lastPollTime = new Date();
    
    // Auto-save matching jobs to agents
    const savedCount = await this.autoSaveToAgents(newProposals);
    console.log(`[AutoBidderV3] Auto-saved ${savedCount} proposals to agents`);
    
    return newProposals;
  }
  
  // Match jobs to agents and save proposals
  async autoSaveToAgents(matchingJobs) {
    let savedCount = 0;
    
    // Get all registered agents
    const agents = getAllAgents();
    
    if (agents.length === 0) {
      console.log('[AutoBidderV3] No agents registered, skipping auto-save');
      return 0;
    }
    
    console.log(`[AutoBidderV3] Checking ${matchingJobs.length} jobs against ${agents.length} agents`);
    
    for (const jobWrapper of matchingJobs) {
      const job = jobWrapper.job || jobWrapper;
      
      for (const agent of agents) {
        // Skip if agent has no capabilities
        if (!agent.capabilities || agent.capabilities.length === 0) continue;
        
        // Check if job matches agent's capabilities
        const agentCaps = agent.capabilities.map(c => c.toLowerCase());
        const jobText = `${job.title} ${job.description || ''}`.toLowerCase();
        
        const matches = agentCaps.some(cap => jobText.includes(cap));
        
        if (!matches) continue;
        
        // Check if already saved
        if (proposalExists(agent.id, job.id, job.source)) {
          continue;
        }
        
        // Save proposal to agent
        try {
          saveProposal({
            agent_id: agent.id,
            job_id: job.id,
            source: job.source,
            source_name: job.sourceName || job.source,
            job_title: job.title,
            job_description: job.description || '',
            job_url: job.url || '',
            payout: job.payout || 0,
            currency: job.currency || 'USDC',
            skills: job.skills || [],
            status: 'found',
            matched_at: new Date().toISOString()
          });
          
          savedCount++;
          console.log(`[AutoBidderV3] ✓ Saved "${job.title.substring(0,30)}" to agent "${agent.name}"`);
        } catch (e) {
          console.error(`[AutoBidderV3] Error saving to agent ${agent.id}:`, e.message);
        }
      }
    }
    
    return savedCount;
  }
  
  analyzeJob(job) {
    const text = `${job.title} ${job.description} ${(job.skills || []).join(' ')}`.toLowerCase();
    let score = 0;
    const matchedCapabilities = [];
    
    for (const [cap, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          score += 2;
          if (!matchedCapabilities.includes(cap)) matchedCapabilities.push(cap);
          break;
        }
      }
    }
    
    if (job.payout > 100) score += 3;
    if (job.payout > 500) score += 5;
    
    return { canBid: score >= 3, score, capabilities: matchedCapabilities };
  }
  
  async generateProposal(id, agentId) {
    // Get proposal from DB
    const proposals = getAgentProposals(agentId, null, 1000);
    const proposal = proposals.find(p => p.id == id);
    if (!proposal) throw new Error('Proposal not found');
    if (proposal.proposal_text) return proposal;
    
    // Generate using AI - skills already parsed by getAgentProposals
    const job = {
      title: proposal.job_title,
      description: proposal.job_description,
      payout: proposal.payout,
      source: proposal.source,
      skills: proposal.skills || []
    };
    
    const analysis = this.analyzeJob(job);
    const aiProposal = await generator.generateProposal(job, analysis);
    const proposalText = generator.formatProposal(aiProposal);
    
    // Update in DB
    db.prepare('UPDATE proposals SET proposal_text = ?, status = ?, generated_at = ? WHERE id = ?')
      .run(proposalText, 'generated', new Date().toISOString(), id);
    
    return { ...proposal, proposal_text: proposalText, status: 'generated' };
  }
}

const autobidder = new AutoBidderV3();
module.exports = { autobidder: autobidder, AutoBidderV3 };
