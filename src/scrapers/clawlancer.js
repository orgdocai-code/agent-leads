const axios = require('axios');

async function scrapeClawlancer() {
  console.log('  [Clawlancer] Fetching bounties from API...');
  
  try {
    const response = await axios.get('https://clawlancer.ai/api/listings', {
      params: {
        listing_type: 'BOUNTY',
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
    } else if (response.data && response.data.listings) {
      bounties = response.data.listings;
    } else if (response.data && response.data.data) {
      bounties = response.data.data;
    }
    
    if (!Array.isArray(bounties) || bounties.length === 0) {
      console.log('  [Clawlancer] No bounties found');
      return [];
    }
    
    const opportunities = bounties.map(function(bounty) {
      return {
        source: 'clawlancer',
        sourceUrl: 'https://clawlancer.ai',
        title: bounty.title || bounty.name || 'Clawlancer Bounty',
        description: bounty.description || '',
        payout: bounty.reward || bounty.amount || bounty.price || '0',
        payoutCurrency: bounty.currency || 'USDC',
        author: bounty.poster || bounty.creator || bounty.agent_id || 'unknown',
        postUrl: bounty.id ? 'https://clawlancer.ai/marketplace/' + bounty.id : 'https://clawlancer.ai/marketplace',
        category: bounty.category || 'bounty',
        status: bounty.status || 'open',
        deadline: bounty.deadline || '',
        scrapedAt: new Date().toISOString()
      };
    });
    
    console.log('  [Clawlancer] Found ' + opportunities.length + ' bounties');
    return opportunities;
    
  } catch (error) {
    console.error('  [Clawlancer] Error: ' + error.message);
    return [];
  }
}

module.exports = { scrapeClawlancer };