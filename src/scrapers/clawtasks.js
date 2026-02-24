const axios = require('axios');

async function scrapeClawTasks() {
  console.log('  [ClawTasks] Fetching bounties from API...');
  
  try {
    var response = await axios.get('https://clawtasks.com/api/bounties', {
      headers: {
        'User-Agent': 'AgentLeads/1.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    var data = response.data;
    var bounties = data.bounties || [];
    
    var opportunities = bounties.map(function(b) {
      return {
        source: 'clawtasks',
        sourceUrl: 'https://clawtasks.com',
        title: b.title || 'Untitled Bounty',
        description: b.description || '',
        payout: b.amount || '0',
        payoutCurrency: 'USDC',
        author: b.poster_id || 'unknown',
        postUrl: 'https://clawtasks.com/bounty/' + b.id,
        category: 'bounty',
        status: b.status || 'open',
        deadline: b.deadline_hours ? b.deadline_hours + ' hours' : '',
        scrapedAt: new Date().toISOString()
      };
    });
    
    console.log('  [ClawTasks] Found ' + opportunities.length + ' bounties');
    return opportunities;
    
  } catch (error) {
    console.error('  [ClawTasks] Error: ' + error.message);
    return [];
  }
}

module.exports = { scrapeClawTasks: scrapeClawTasks };
