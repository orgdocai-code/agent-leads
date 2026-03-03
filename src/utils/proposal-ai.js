// Auto-Bidder Phase 2: AI-Powered Proposal Generation
// Uses AI to generate compelling proposals for high-paying jobs

const axios = require('axios');

// Our capabilities database
const CAPABILITY_DATABASE = {
  'web scraping': { score: 9, description: 'Advanced web scraping and data extraction' },
  'api development': { score: 10, description: 'REST and GraphQL API development' },
  'frontend': { score: 8, description: 'Modern React/Next.js frontend development' },
  'backend': { score: 9, description: 'Node.js, Python backend services' },
  'automation': { score: 10, description: 'Workflow automation and bot development' },
  'ai integration': { score: 9, description: 'AI/ML model integration' },
  'database': { score: 8, description: 'Database design and optimization' },
  'discord bot': { score: 10, description: 'Discord bot development' },
  'telegram': { score: 9, description: 'Telegram bot and mini-app development' },
  'data analysis': { score: 7, description: 'Data analysis and visualization' },
  'security': { score: 6, description: 'Security auditing' },
  'smart contract': { score: 5, description: 'Solidity smart contracts' }
};

// Industry keywords mapping
const INDUSTRY_KEYWORDS = {
  'defi': ['smart contract', 'solidity', 'uniswap', 'token'],
  'ai': ['ai', 'ml', 'machine learning', 'llm', 'gpt'],
  'social': ['discord', 'telegram', 'twitter', 'social media'],
  'ecommerce': ['shopify', 'stripe', 'payment', 'cart'],
  'productivity': ['automation', 'workflow', 'notion', 'slack']
};

class AIProposalGenerator {
  constructor() {
    this.minPayout = 50; // USDC
    this.maxProposals = 100;
  }
  
  // Analyze job and calculate match score
  analyzeJob(job) {
    const text = `${job.title} ${job.description || ''} ${(job.tags || []).join(' ')}`.toLowerCase();
    
    let matchScore = 0;
    let matchedCapabilities = [];
    let industry = null;
    
    // Check capabilities
    for (const [cap, info] of Object.entries(CAPABILITY_DATABASE)) {
      if (text.includes(cap)) {
        matchScore += info.score;
        matchedCapabilities.push({ name: cap, ...info });
      }
    }
    
    // Check industries
    for (const [ind, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
      if (keywords.some(k => text.includes(k))) {
        industry = ind;
        break;
      }
    }
    
    return {
      score: matchScore,
      capabilities: matchedCapabilities,
      industry,
      canBid: matchScore >= 5
    };
  }
  
  // Generate AI-powered proposal
  async generateProposal(job, analysis) {
    const proposal = {
      job: {
        id: job.id,
        title: job.title,
        payout: job.payout,
        source: job.source
      },
      analysis,
      sections: [],
      generatedAt: new Date().toISOString()
    };
    
    // Generate introduction
    proposal.sections.push({
      type: 'intro',
      content: this.generateIntro(job, analysis)
    });
    
    // Generate approach
    proposal.sections.push({
      type: 'approach',
      content: this.generateApproach(job, analysis)
    });
    
    // Generate timeline
    proposal.sections.push({
      type: 'timeline',
      content: this.generateTimeline(job, analysis)
    });
    
    // Generate why us
    proposal.sections.push({
      type: 'why_us',
      content: this.generateWhyUs(analysis)
    });
    
    // Generate pricing
    proposal.sections.push({
      type: 'pricing',
      content: this.generatePricing(job)
    });
    
    return proposal;
  }
  
  generateIntro(job, analysis) {
    return `## ${job.title}

**Reward:** $${job.payout} USDC

Thank you for posting this opportunity. After reviewing the requirements, we believe AgentLeads is uniquely positioned to deliver a high-quality solution.`;
  }
  
  generateApproach(job, analysis) {
    const caps = analysis.capabilities.slice(0, 3).map(c => c.description).join(', ');
    
    return `## Our Approach

We will leverage our existing infrastructure in ${caps}.

Key deliverables:
1. **Discovery & Planning** - Full requirement analysis
2. **Development** - Iterative build with regular updates
3. **Testing** - Comprehensive QA
4. **Deployment** - Production rollout`;
  }
  
  generateTimeline(job, analysis) {
    const days = job.payout > 500 ? '7-10 days' : job.payout > 200 ? '5-7 days' : '3-5 days';
    
    return `## Timeline

- **Day 1-2:** Discovery & Architecture
- **Day 3-5:** Development  
- **Day 6:** Testing & QA
- **Day 7:** Deployment

**Estimated Total:** ${days}`;
  }
  
  generateWhyUs(analysis) {
    const caps = analysis.capabilities.slice(0, 3).map(c => c.name).join(', ');
    
    return `## Why AgentLeads?

✓ **Expertise:** ${caps || 'Automation & Development'}
✓ **Speed:** Rapid delivery using proven patterns
✓ **Quality:** Production-tested solutions
✓ **Support:** Post-delivery maintenance available

We've successfully completed similar projects for clients worldwide.`;
  }
  
  generatePricing(job) {
    const budget = job.payout;
    const ourFee = Math.round(budget * 0.1); // 10% of bounty as our fee
    
    return `## Investment

- **Bounty Value:** $${budget} USDC
- **Our Service Fee:** $${ourFee} USDC (10%)
- **Your Net:** $${budget - ourFee} USDC

We work on a success-fee basis - you only pay when the work is accepted.`;
  }
  
  // Format proposal as markdown
  formatProposal(proposal) {
    return proposal.sections.map(s => s.content).join('\n\n');
  }
}

// Create singleton
const generator = new AIProposalGenerator();

module.exports = {
  AIProposalGenerator: AIProposalGenerator,
  generator: generator
};
