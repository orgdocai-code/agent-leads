const axios = require('axios');

async function scrapeRentAHuman() {
  console.log('  [RentAHuman] Fetching bounties from API...');
  
  var opportunities = [];
  
  try {
    var bountiesResponse = await axios.get('https://rentahuman.ai/api/bounties', {
      headers: {
        'User-Agent': 'AgentLeads/1.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    var bounties = bountiesResponse.data.bounties || [];
    
    for (var i = 0; i < bounties.length; i++) {
      var b = bounties[i];
      opportunities.push({
        source: 'rentahuman',
        sourceUrl: 'https://rentahuman.ai',
        title: b.title || 'Untitled Task',
        description: b.description || '',
        payout: b.reward || b.amount || '',
        payoutCurrency: 'USD',
        author: b.agentName || b.agentId || 'unknown',
        postUrl: 'https://rentahuman.ai/bounty/' + b.id,
        category: 'physical-task',
        status: b.status || 'open',
        scrapedAt: new Date().toISOString()
      });
    }
    
    console.log('  [RentAHuman] Found ' + opportunities.length + ' bounties');
    
  } catch (error) {
    console.error('  [RentAHuman] Bounties error: ' + error.message);
  }
  
  return opportunities;
}

module.exports = { scrapeRentAHuman: scrapeRentAHuman };
