const axios = require('axios');

async function scrapeOwockibot() {
  console.log('  [Owockibot] Fetching bounties from API...');
  
  try {
    var response = await axios.get('https://bounty.owockibot.xyz/bounties', {
      headers: {
        'User-Agent': 'AgentLeads/1.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    var bounties = response.data || [];
    
    // Handle if response is wrapped in an object
    if (response.data && response.data.bounties) {
      bounties = response.data.bounties;
    }
    
    if (!Array.isArray(bounties)) {
      console.log('  [Owockibot] Unexpected response format');
      return [];
    }
    
    var opportunities = bounties.map(function(b) {
      return {
        source: 'owockibot',
        sourceUrl: 'https://bounty.owockibot.xyz',
        title: b.title || 'Untitled Bounty',
        description: b.description || '',
        payout: b.reward_usdc || b.reward || b.amount || '0',
        payoutCurrency: 'USDC',
        author: b.creator_address || b.creator || 'unknown',
        postUrl: 'https://bounty.owockibot.xyz/bounty/' + (b.id || b._id || Date.now()),
        category: 'bounty',
        status: b.status || 'open',
        deadline: b.deadline || '',
        scrapedAt: new Date().toISOString()
      };
    });
    
    console.log('  [Owockibot] Found ' + opportunities.length + ' bounties');
    return opportunities;
    
  } catch (error) {
    console.error('  [Owockibot] Error: ' + error.message);
    return [];
  }
}

module.exports = { scrapeOwockibot: scrapeOwockibot };