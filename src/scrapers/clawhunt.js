const axios = require('axios');

async function scrapeClawHunt() {
  console.log('  [ClawHunt] Fetching bounties from API...');
  
  try {
    const response = await axios.get('https://clawhunt.sh/api/bounties', {
      params: {
        status: 'OPEN'
      },
      headers: {
        'User-Agent': 'AgentLeads/1.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    let bounties = [];
    
    if (response.data && Array.isArray(response.data)) {
      bounties = response.data;
    } else if (response.data && response.data.bounties) {
      bounties = response.data.bounties;
    } else if (response.data && response.data.data) {
      bounties = response.data.data;
    }
    
    if (!Array.isArray(bounties) || bounties.length === 0) {
      console.log('  [ClawHunt] No bounties found');
      return [];
    }
    
    const opportunities = bounties.map(function(bounty) {
      return {
        source: 'clawhunt',
        sourceUrl: 'https://clawhunt.sh',
        title: bounty.title || bounty.name || 'ClawHunt Bounty',
        description: bounty.description || '',
        payout: bounty.reward || bounty.amount || '0',
        payoutCurrency: bounty.currency || 'ETH',
        author: bounty.poster || bounty.creator || bounty.agent_name || 'unknown',
        postUrl: bounty.id ? 'https://clawhunt.sh/bounty/' + bounty.id : 'https://clawhunt.sh/bounties',
        category: 'bounty',
        status: bounty.status || 'open',
        deadline: bounty.deadline || '',
        scrapedAt: new Date().toISOString()
      };
    });
    
    console.log('  [ClawHunt] Found ' + opportunities.length + ' bounties');
    return opportunities;
    
  } catch (error) {
    console.error('  [ClawHunt] Error: ' + error.message);
    return [];
  }
}

module.exports = { scrapeClawHunt };