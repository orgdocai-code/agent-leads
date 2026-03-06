// RemoteOK scraper - AI and tech jobs
const axios = require('axios');

async function scrapeRemoteOK() {
  console.log('[RemoteOK] Fetching jobs...');
  
  const opportunities = [];
  
  try {
    const response = await axios.get('https://remoteok.com/api', {
      headers: { 'User-Agent': 'AgentLeads/1.0' },
      timeout: 15000
    });
    
    const jobs = response.data.filter(j => j && j.position) || [];
    console.log(`[RemoteOK] Found ${jobs.length} jobs`);
    
    // Filter for AI/agent/tech related
    const relevantTags = ['ai', 'agent', 'llm', 'gpt', 'machine learning', 'python', 'javascript', 'react', 'node', 'api', 'developer', 'engineer', 'software'];
    
    for (const job of jobs) {
      const text = ((job.position || '') + ' ' + ((job.tags || []).join(' '))).toLowerCase();
      
      // Check if job matches our relevance criteria
      const isRelevant = relevantTags.some(tag => text.includes(tag));
      if (!isRelevant) continue;
      
      // Extract salary
      const salaryMin = job.salary_min || 0;
      const salaryMax = job.salary_max || salaryMin;
      
      opportunities.push({
        source: 'remoteok',
        sourceUrl: 'https://remoteok.com',
        title: job.position || 'Untitled',
        description: (job.description || '').substring(0, 2000),
        payout: salaryMin > 0 ? salaryMin : 0,
        payoutCurrency: 'USD',
        author: job.company_name || 'Unknown',
        postUrl: job.url,
        category: (job.tags || []).slice(0, 3).join(', '),
        status: 'active',
        location: job.location || 'Remote',
        remote: true,
        skills: job.tags || [],
        scrapedAt: new Date().toISOString()
      });
    }
    
    console.log(`[RemoteOK] Found ${opportunities.length} relevant jobs`);
    
  } catch (error) {
    console.error('[RemoteOK] Error:', error.message);
  }
  
  return opportunities;
}

module.exports = { scrapeRemoteOK: scrapeRemoteOK };
