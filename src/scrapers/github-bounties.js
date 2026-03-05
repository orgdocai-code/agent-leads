// GitHub Issues Bounty Scraper
const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const HEADERS = {
  'User-Agent': 'AgentLeads/1.0',
  'Accept': 'application/vnd.github.v3+json'
};

if (GITHUB_TOKEN) {
  HEADERS['Authorization'] = `token ${GITHUB_TOKEN}`;
}

async function scrapeGitHubBounties() {
  console.log('[GitHub] Searching for bounty issues...');
  const opportunities = [];
  
  try {
    const query = 'label:bounty is:issue state:open sort:created-desc';
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=30`;
    const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const issues = response.data.items || [];
    
    console.log(`[GitHub] Found ${issues.length} bounty issues`);
    
    for (const issue of issues) {
      let payout = 0;
      let currency = 'USD';
      const dollarMatch = issue.body?.match(/\$[\d,]+(?:\.\d{2})?/);
      if (dollarMatch) {
        payout = parseFloat(dollarMatch[0].replace('$', '').replace(',', ''));
      }
      
      const tags = issue.labels?.map(l => l.name).filter(l => l !== 'bounty') || [];
      
      opportunities.push({
        source: 'github',
        sourceUrl: 'https://github.com',
        title: issue.title,
        description: issue.body?.substring(0, 2000) || '',
        payout: payout,
        payoutCurrency: currency,
        author: issue.user?.login || 'unknown',
        postUrl: issue.html_url,
        category: tags.join(', ') || 'open-source',
        status: 'open',
        skills: tags,
        scrapedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('[GitHub] Error:', error.message);
  }
  
  return opportunities;
}

module.exports = { scrapeGitHubBounties };
