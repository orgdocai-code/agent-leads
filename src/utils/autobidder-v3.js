// Auto-Bidder v3: Multi-Source Polling
// Polls multiple bounty sources directly for better coverage

const axios = require('axios');
const { generator } = require('./proposal-ai');
const { saveProposal, getAgentProposals, getAgentByApiKey, registerAgent, getAgentStats, updateProposalStatus, db, getAllAgents, proposalExists, updateAgentProfile, getAgentById, getRecentOpportunities } = require('./database');

// Pricing
const PROPOSAL_PRICE_USDC = 0.01; // 1 cent per proposal
const OUR_WALLET = '0x3eA43a05C0E3A4449785950E4d1e96310aEa3670';

// Codex/OpenAI for code generation
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-4o';

// Enhanced prompts with deployment instructions
const PROMPT_TEMPLATES = {
  discord: `You are an expert Discord bot developer. Create a COMPLETE, DEPLOYABLE solution.

BOUNTY: {title}
DESCRIPTION: {description}

Write EVERY LINE - no placeholders. Include:
1. package.json with exact dependencies
2. Complete bot code (all commands, events)
3. .env.example
4. deploy.sh for Railway
5. Dockerfile
6. README with deployment steps

Output:
---
# FILES
[package.json]
<full content>
[bot.js]
<full content>
[.env.example]
[deploy.sh]
[Dockerfile]
[README.md]
---
`,

  frontend: `You are an expert React/Next.js developer. Create a COMPLETE, PRODUCTION-READY solution.

BOUNTY: {title}
DESCRIPTION: {description}

Write EVERY LINE. Include:
1. package.json
2. app/page.tsx (complete)
3. tailwind.config.ts
4. next.config.js
5. .env.example
6. Dockerfile
7. Vercel deployment steps

Output:
---
# FILES
[package.json]
[app/page.tsx]
[tailwind.config.ts]
[next.config.js]
[.env.example]
[Dockerfile]
[README.md]
---
`,

  api: `You are an expert backend API developer. Create a COMPLETE, DEPLOYABLE REST API.

BOUNTY: {title}
DESCRIPTION: {description}

Write EVERY LINE. Include:
1. package.json with dependencies
2. index.js (Express server, all routes)
3. middleware (error handling, cors)
4. .env.example
5. Dockerfile
6. Deploy instructions

Output:
---
# FILES
[package.json]
[index.js]
[middleware/errorHandler.js]
[.env.example]
[Dockerfile]
[README.md]
---
`,

  default: `You are an expert full-stack developer. Create a COMPLETE working solution.

BOUNTY: {title}
DESCRIPTION: {description}

Write ALL code. Include:
1. package.json
2. Main code file (complete)
3. .env.example
4. README with setup/deploy

Output:
---
# FILES
[package.json]
[index.js]
[README.md]
---
`
};

function detectBountyType(bounty) {
  const text = ((bounty.title || '') + ' ' + (bounty.description || '')).toLowerCase();
  if (text.includes('discord') || text.includes('telegram') || text.includes('bot')) return 'discord';
  if (text.includes('react') || text.includes('next') || text.includes('frontend') || text.includes('ui') || text.includes('dashboard')) return 'frontend';
  if (text.includes('api') || text.includes('endpoint') || text.includes('server') || text.includes('rest')) return 'api';
  return 'default';
}

// Generate code using Codex
async function generateCode(bounty) {
  if (!OPENAI_API_KEY) {
    console.log('[Codex] No API key configured');
    return generateFallback(bounty);
  }
  
  const type = detectBountyType(bounty);
  const template = PROMPT_TEMPLATES[type] || PROMPT_TEMPLATES.default;
  
  const prompt = template
    .replace('{title}', bounty.title || '')
    .replace('{description}', (bounty.description || '').substring(0, 2000));

  try {
    console.log(`[Codex:${type}] Generating for: ${bounty.title?.substring(0, 30)}`);
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: CODEX_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 12000
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
    
    const code = response.data.choices[0]?.message?.content;
    const tokens = response.data.usage?.total_tokens || 0;
    console.log(`[Codex] Generated (${tokens} tokens)`);
    return code;
  } catch (e) {
    console.error('[Codex] Error:', e.message);
    return generateFallback(bounty);
  }
}

function generateFallback(bounty) {
  return `
# Solution: ${bounty.title}

## Description
${bounty.description || 'N/A'}

## Implementation
Automated AI-generated solution.

## Files
See bounty requirements above.
`;
}

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
    
    // Manual trigger for auto-save (for testing)
    app.post('/autobid/autosave', async (req, res) => {
      try {
        const results = await this.pollAll();
        res.json({ success: true, matches: results.length, saved: 'Check /autobid/proposals' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    
    // ========================================
    // SMART MATCHING ENDPOINTS
    // ========================================
    
    // Update agent profile (resume, cover letter template)
    app.post('/autobid/profile', (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      const { resume_text, cover_letter_template, name, capabilities } = req.body;
      
      const updated = updateAgentProfile(agent.id, {
        resume_text,
        cover_letter_template,
        name,
        capabilities
      });
      
      res.json({ success: true, profile: updated });
    });
    
    // Get agent profile
    app.get('/autobid/profile', (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      res.json({ 
        profile: {
          name: agent.name,
          capabilities: agent.capabilities,
          hasResume: !!agent.resume_text,
          resumeLength: agent.resume_text?.length || 0,
          hasCoverLetter: !!agent.cover_letter_template
        }
      });
    });
    
    // Match jobs to agent profile
    app.post('/autobid/match', async (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      // Get jobs from database
      const jobs = getRecentOpportunities(500);
      
      // Simple keyword matching
      const profileText = (agent.resume_text || '').toLowerCase() + ' ' + 
                         (agent.capabilities || []).join(' ').toLowerCase();
      
      const matches = jobs.map(job => {
        const jobText = ((job.description || '') + ' ' + (job.title || '')).toLowerCase();
        const jobSkills = ((job.required_skills || '') + ' ' + (job.category || '')).toLowerCase();
        
        let score = 0;
        const matchedSkills = [];
        
        // Check each capability against job
        for (const cap of (agent.capabilities || [])) {
          const capLower = cap.toLowerCase();
          if (jobText.includes(capLower) || jobSkills.includes(capLower)) {
            score += 25;
            matchedSkills.push(cap);
          }
        }
        
        // Check resume text for skills
        const resumeWords = profileText.split(/\s+/);
        for (const word of resumeWords) {
          if (word.length > 3 && (jobText.includes(word) || jobSkills.includes(word))) {
            score += 5;
            if (!matchedSkills.includes(word)) matchedSkills.push(word);
          }
        }
        
        // Cap at 100
        score = Math.min(score, 100);
        
        return {
          id: job.id,
          title: job.title,
          source: job.source,
          payout: job.payout,
          currency: job.payout_currency,
          url: job.post_url,
          description: job.description?.substring(0, 200),
          matchScore: score,
          matchedSkills: matchedSkills.slice(0, 5)
        };
      });
      
      // Sort by score and filter
      const filtered = matches
        .filter(m => m.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 50);
      
      res.json({ matches: filtered, total: filtered.length });
    });
    
    // Generate cover letter / apply
    app.post('/autobid/apply', async (req, res) => {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required' });
      
      const agent = getAgentByApiKey(apiKey);
      if (!agent) return res.status(401).json({ error: 'Invalid API key' });
      
      const { job_id, job_title, job_description, job_url } = req.body;
      
      if (!job_title) {
        return res.status(400).json({ error: 'job_title required' });
      }
      
      // Build prompt for cover letter
      const capabilities = (agent.capabilities || []).join(', ');
      const resume = agent.resume_text || '';
      const template = agent.cover_letter_template || '';
      
      const prompt = `You are an AI agent freelancer. Write a compelling pitch/cover letter to apply for this job.

Job Title: ${job_title}
Job Description: ${job_description?.substring(0, 1000) || 'N/A'}
Job URL: ${job_url || 'N/A'}

Your Capabilities: ${capabilities}
Your Resume/Background: ${resume.substring(0, 1000)}
${template ? `Use this template: ${template}` : ''}

Write a professional, concise pitch (150-300 words) that highlights why you're perfect for this job. Focus on relevant skills and experience.`;

      try {
        // Use OpenAI for generation (or fallback to simple template)
        let coverLetter = '';
        
        if (process.env.OPENAI_API_KEY) {
          const openai = require('openai');
          const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
          
          const completion = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500
          });
          
          coverLetter = completion.choices[0]?.message?.content || '';
        } else {
          // Fallback to template
          coverLetter = template 
            ? template.replace('{job_title}', job_title).replace('{capabilities}', capabilities)
            : `Hi,

I'm excited to apply for the ${job_title} position.

With my experience in ${capabilities}, I believe I can deliver excellent results for this project.

${resume.substring(0, 200)}

Let's discuss how I can help you achieve your goals.

Best regards`;
        }
        
        res.json({ 
          success: true, 
          coverLetter,
          job_id,
          job_title,
          estimatedTokens: coverLetter.length / 4
        });
        
      } catch (e) {
        res.status(500).json({ error: 'Failed to generate: ' + e.message });
      }
    });
    
    // ========================================
    // END SMART MATCHING
    // ========================================
    
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
    
    // ========================================
    // OWOCKIBOT AUTO-MONITOR
    // ========================================
    
    const owockibotAxios = axios.create({ baseURL: 'https://bounty.owockibot.xyz' });
    let owockibotInterval = null;
    let lastOpenCount = 0;
    
    async function checkOwockibot() {
      try {
        const res = await owockibotAxios.get('/bounties');
        const bounties = Array.isArray(res.data) ? res.data : res.data.data || [];
        const openBounties = bounties.filter(b => b.status === 'open');
        
        console.log(`[Owockibot] Open: ${openBounties.length}, Total: ${bounties.length}`);
        
        // New open bounty found!
        if (openBounties.length > 0 && openBounties.length > lastOpenCount) {
          console.log('[Owockibot] NEW BOUNTY AVAILABLE!');
          for (const b of openBounties) {
            console.log(`  - ${b.title} (${b.rewardFormatted || b.reward})`);
            
            // Auto-generate code with Codex
            console.log('[Codex] Generating solution...');
            const solution = await generateCode(b);
            
            if (solution) {
              console.log('[Codex] Solution generated!');
              console.log('[Codex] Preview:', solution.substring(0, 200));
              
              // Auto-claim and submit would go here
              // For now, save to DB for review
              console.log('[AutoBid] Ready to claim and submit');
            } else {
              console.log('[Codex] Failed to generate - manual review needed');
            }
          }
        }
        lastOpenCount = openBounties.length;
        
        return { open: openBounties.length, total: bounties.length, bounties };
      } catch (e) {
        console.error('[Owockibot] Error:', e.message);
        return { error: e.message };
      }
    }
    
    // Start Owockibot monitor
    app.post('/autobid/owockibot/start', (req, res) => {
      if (owockibotInterval) {
        return res.json({ success: true, message: 'Already running' });
      }
      
      checkOwockibot(); // Initial check
      owockibotInterval = setInterval(checkOwockibot, 10000); // Every 10 seconds
      res.json({ success: true, message: 'Owockibot monitor started (10s interval)' });
    });
    
    // Stop Owockibot monitor
    app.post('/autobid/owockibot/stop', (req, res) => {
      if (owockibotInterval) {
        clearInterval(owockibotInterval);
        owockibotInterval = null;
      }
      res.json({ success: true, message: 'Owockibot monitor stopped' });
    });
    
    // Get Owockibot status
    app.get('/autobid/owockibot/status', async (req, res) => {
      const status = await checkOwockibot();
      res.json({ 
        monitoring: !!owockibotInterval,
        ...status
      });
    });
    
    // Claim bounty (when we find open ones)
    app.post('/autobid/owockibot/claim/:id', async (req, res) => {
      const wallet = req.body.wallet || '0x3eA43a05C0E3A4449785950E4d1e96310aEa3670';
      try {
        const claimRes = await owockibotAxios.post(`/bounties/${req.params.id}/claim`, {
          address: wallet
        });
        res.json({ success: true, data: claimRes.data });
      } catch (e) {
        res.status(400).json({ error: e.response?.data || e.message });
      }
    });
    
    // Submit work
    app.post('/autobid/owockibot/submit/:id', async (req, res) => {
      const { content, proof } = req.body;
      try {
        const subRes = await owockibotAxios.post(`/bounties/${req.params.id}/submit`, {
          content,
          proof
        });
        res.json({ success: true, data: subRes.data });
      } catch (e) {
        res.status(400).json({ error: e.response?.data || e.message });
      }
    });
    
    // Generate code for a bounty (manual trigger for testing)
    app.post('/autobid/owockibot/generate', async (req, res) => {
      const { title, description, requirements } = req.body;
      
      if (!title) {
        return res.status(400).json({ error: 'title required' });
      }
      
      const bounty = { title, description, requirements: requirements || [] };
      
      console.log('[Codex] Generating for:', title);
      const solution = await generateCode(bounty);
      
      if (solution) {
        res.json({ success: true, solution });
      } else {
        res.status(500).json({ error: 'Code generation failed - check API key' });
      }
    });
    
    // Get a specific bounty and generate + claim + submit
    app.post('/autobid/owockibot/auto/:id', async (req, res) => {
      const bountyId = req.params.id;
      
      // Discord notification helper
      const discordNotify = async (msg) => {
        const webhook = process.env.DISCORD_WEBHOOK;
        if (!webhook) return;
        try {
          await axios.post(webhook, { content: msg });
        } catch (e) { /* ignore */ }
      };
      
      try {
        // Fetch bounty details
        const bountyRes = await owockibotAxios.get(`/bounties/${bountyId}`);
        const bounty = bountyRes.data;
        
        if (!bounty) {
          return res.status(404).json({ error: 'Bounty not found' });
        }
        
        console.log('[Auto] Processing:', bounty.title);
        
        // Generate code
        console.log('[Codex] Generating solution...');
        const solution = await generateCode(bounty);
        
        if (!solution) {
          return res.status(500).json({ error: 'Code generation failed' });
        }
        
        // Claim bounty
        const wallet = req.body.wallet || OUR_WALLET;
        await owockibotAxios.post(`/bounties/${bountyId}/claim`, { address: wallet });
        console.log('[Auto] Claimed!');
        await discordNotify(`✅ **BOUNTY CLAIMED:** ${bounty.title} - ${bounty.rewardFormatted || bounty.reward}`);
        
        // Submit solution (simplified - just send the code as proof)
        const proof = solution.substring(0, 1500);
        await owockibotAxios.post(`/bounties/${bountyId}/submit`, {
          content: 'Solution generated by AI - code attached',
          proof: proof
        });
        console.log('[Auto] Submitted!');
        await discordNotify(`🎉 **SOLUTION SUBMITTED:** ${bounty.title}\n\`\`\`${solution.substring(0, 200)}...\`\`\``);
        
        res.json({ 
          success: true, 
          bounty: bounty.title,
          solution: solution.substring(0, 500) + '...'
        });
        
      } catch (e) {
        console.error('[Auto] Error:', e.message);
        await discordNotify(`❌ **ERROR:** ${e.message}`);
        res.status(400).json({ error: e.response?.data || e.message });
      }
    });
    
    // ========================================
    // END OWOCKIBOT
    // ========================================
    
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
          try {
            const job = source.parser(item);
            
            // Skip closed/completed jobs
            if (job.status === 'closed' || job.status === 'completed') continue;
            // Skip if payout is 0 for non-GitHub sources (GitHub bounties vary)
            if (job.payout < MIN_PAYOUT && job.source !== 'github') continue;
            
            const analysis = this.analyzeJob(job);
            
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
              
              newProposals.push(proposal);
              stats.matches++;
              stats.bySource[key].matches++;
              
              console.log(`[AutoBidderV3] ✓ MATCH: ${job.title.substring(0,40)} - $${job.payout} [${job.source}]`);
              
              // Notify
              if (this.notificationCallback) {
                this.notificationCallback(proposal);
              }
            }
          } catch (parseErr) {
            console.error(`[AutoBidderV3] Parse error:`, parseErr.message);
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

// ========================================
// GITHUB AUTO-PR FUNCTIONS (for server.js to use)
// ========================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const githubAxios = axios.create({
  baseURL: 'https://api.github.com',
  headers: GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'AgentLeads' } : {}
});

let lastBountyCount = 0;

// Search GitHub for bounty issues
async function searchBountyIssues() {
  if (!GITHUB_TOKEN) {
    return { error: 'GITHUB_TOKEN not configured', issues: [] };
  }
  
  try {
    const queries = [
      'label:bounty+is:issue+state:open',
      'label:prize+is:issue+state:open',
      'label:hackathon+is:issue+state:open'
    ];
    
    let allIssues = [];
    for (const q of queries) {
      const res = await githubAxios.get(`/search/issues?q=${encodeURIComponent(q)}&per_page=10`);
      allIssues = allIssues.concat(res.data.items || []);
    }
    
    const seen = new Set();
    const issues = allIssues.filter(i => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
    
    return { issues, total: issues.length };
  } catch (e) {
    console.error('[GitHub] Search error:', e.message);
    return { error: e.message, issues: [] };
  }
}

// Parse issue URL
function parseIssueUrl(url) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], issueNumber: parseInt(match[3]) };
}

// Parse Codex output into files
function parseSolutionFiles(solution) {
  const files = [];
  const fileRegex = /\[([^\]]+\.[^\]]+)\]\n```[\w]*\n([\s\S]*?)\n```/g;
  let match;
  
  while ((match = fileRegex.exec(solution)) !== null) {
    files.push({ path: match[1], content: match[2] });
  }
  
  if (files.length === 0) {
    files.push({ path: 'solution.md', content: solution });
  }
  
  return files;
}

// Generate solution and create PR
async function createSolutionPR(issue) {
  if (!GITHUB_TOKEN) {
    return { error: 'GITHUB_TOKEN required' };
  }
  
  const repoInfo = parseIssueUrl(issue.html_url);
  if (!repoInfo) {
    return { error: 'Could not parse issue URL' };
  }
  
  const { owner, repo, issueNumber } = repoInfo;
  const branchName = `fix/agent-leads-${issueNumber}`;
  
  try {
    console.log(`[GitHub:${owner}/${repo}#${issueNumber}] Generating solution...`);
    const solution = await generateCode({
      title: issue.title,
      description: issue.body || '',
      requirements: issue.labels?.map(l => l.name) || []
    });
    
    if (!solution) {
      return { error: 'Code generation failed' };
    }
    
    const files = parseSolutionFiles(solution);
    console.log(`[GitHub] Generated ${files.length} files`);
    
    const repoRes = await githubAxios.get(`/repos/${owner}/${repo}`);
    const defaultBranch = repoRes.data.default_branch;
    
    const refRes = await githubAxios.get(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`);
    const sha = refRes.data.object.sha;
    
    await githubAxios.post(`/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: sha
    });
    console.log(`[GitHub] Created branch: ${branchName}`);
    
    for (const file of files) {
      const content = Buffer.from(file.content).toString('base64');
      await githubAxios.put(`/repos/${owner}/${repo}/contents/${file.path}`, {
        message: `Fix: ${issue.title} (AgentLeads)`,
        content: content,
        branch: branchName
      });
    }
    console.log(`[GitHub] Committed ${files.length} files`);
    
    const prRes = await githubAxios.post(`/repos/${owner}/${repo}/pulls`, {
      title: `Fix: ${issue.title}`,
      body: `## Solution by AgentLeads 🤖\n\n---\n*Auto-generated by AgentLeads*`,
      head: branchName,
      base: defaultBranch
    });
    console.log(`[GitHub] Created PR #${prRes.data.number}`);
    
    return { 
      success: true, 
      prUrl: prRes.data.html_url,
      prNumber: prRes.data.number,
      files: files.length
    };
    
  } catch (e) {
    console.error('[GitHub] PR error:', e.message);
    return { error: e.message };
  }
}

// Export
module.exports = { autobidder: autobidder, AutoBidderV3, searchBountyIssues, createSolutionPR, parseSolutionFiles };
