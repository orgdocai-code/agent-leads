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
      // Convert reward from raw format (multiply by 1e-6 for USDC)
      var rewardRaw = b.reward || b.reward_usdc || '0';
      var rewardUsdc = parseFloat(rewardRaw) / 1000000;
      
      // Determine status: open = active, completed/claimed = inactive
      var status = (b.status === 'open' || b.status === 'active') ? 'active' : 'completed';
      
      return {
        source: 'owockibot',
        sourceUrl: 'https://bounty.owockibot.xyz',
        title: b.title || 'Untitled Bounty',
        description: b.description || '',
        payout: rewardUsdc.toString(),
        payoutCurrency: 'USDC',
        author: b.creator_address || b.creator || 'unknown',
        postUrl: 'https://bounty.owockibot.xyz/bounty/' + (b.id || b._id || Date.now()),
        category: 'bounty',
        status: status,
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