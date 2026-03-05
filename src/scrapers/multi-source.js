// Multi-Source Bounty Monitor
// Monitors multiple bounty platforms for new opportunities

const axios = require('axios');

// Platform configurations
const PLATFORMS = {
  // GitHub Issues with bounty/prize labels
  github: {
    name: 'GitHub',
    search: async () => {
      const queries = [
        'label:bounty is:issue state:open',
        'label:prize is:issue state:open', 
        'label:hackathon is:issue state:open',
        'label:reward is:issue state:open'
      ];
      
      let allIssues = [];
      for (const q of queries) {
        try {
          const res = await axios.get(
            `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=10`,
            { headers: { 'User-Agent': 'AgentLeads' }, timeout: 10000 }
          );
          allIssues = allIssues.concat(res.data.items || []);
        } catch(e) { /* skip */ }
      }
      
      // Dedupe
      const seen = new Set();
      return allIssues.filter(i => {
        if (seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      }).map(issue => ({
        id: `gh-${issue.id}`,
        source: 'github',
        title: issue.title,
        description: issue.body?.substring(0, 2000) || '',
        url: issue.html_url,
        payout: extractPayout(issue.body),
        currency: 'USD',
        author: issue.user?.login,
        labels: issue.labels?.map(l => l.name) || [],
        created: issue.created_at
      }));
    }
  },
  
  //裂帛Alternatives
  hackathon: {
    name: 'Hackathon',
    search: async () => {
      // Search for hackathon prizes
      const res = await axios.get(
        'https://api.github.com/search/code?q=hackathon+prize+reward&per_page=10',
        { headers: { 'User-Agent': 'AgentLeads' }, timeout: 10000 }
      );
      return (res.data.items || []).map(item => ({
        id: `hack-${item.id}`,
        source: 'hackathon',
        title: item.name,
        description: item.path,
        url: item.html_url,
        payout: 0,
        currency: 'USD'
      }));
    }
  }
};

function extractPayout(text) {
  if (!text) return 0;
  const match = text.match(/\$[\d,]+(?:\.\d{2})?/);
  return match ? parseFloat(match[0].replace(/[$,]/g, '')) : 0;
}

// Main search function
async function searchAllSources() {
  const results = [];
  
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    try {
      const items = await platform.search();
      results.push(...items);
      console.log(`[${platform.name}] Found ${items.length}`);
    } catch(e) {
      console.log(`[${platform.name}] Error: ${e.message}`);
    }
  }
  
  return results;
}

// Auto-claim function for when we find something
async function attemptClaim(item) {
  console.log(`Attempting to claim: ${item.title}`);
  // Implementation depends on platform
}

module.exports = { searchAllSources, attemptClaim, PLATFORMS };
