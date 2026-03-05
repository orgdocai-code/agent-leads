const axios = require('axios');

async function scrapeArbeitnow() {
  console.log('  [Arbeitnow] Fetching jobs from API...');
  
  var opportunities = [];
  
  try {
    var response = await axios.get('https://www.arbeitnow.com/api/job-board-api', {
      headers: {
        'User-Agent': 'AgentLeads/1.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    var jobs = response.data.data || [];
    
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      // Skip jobs with no url
      if (!j.url) continue;
      
      // Extract skills from tags
      var skills = j.tags || [];
      
      opportunities.push({
        source: 'arbeitnow',
        sourceUrl: 'https://arbeitnow.com',
        title: j.title || 'Untitled Job',
        description: j.description ? j.description.replace(/<[^>]*>/g, '').substring(0, 2000) : '',
        payout: 0,
        payoutCurrency: 'USD',
        author: j.company_name || 'Unknown Company',
        postUrl: j.url,
        category: j.remote ? 'remote' : 'onsite',
        status: 'active',
        location: j.location || '',
        remote: j.remote || false,
        skills: skills,
        scrapedAt: new Date().toISOString()
      });
    }
    
    console.log('  [Arbeitnow] Found ' + opportunities.length + ' jobs');
    
  } catch (error) {
    console.error('  [Arbeitnow] Error: ' + error.message);
  }
  
  return opportunities;
}

module.exports = { scrapeArbeitnow: scrapeArbeitnow };
