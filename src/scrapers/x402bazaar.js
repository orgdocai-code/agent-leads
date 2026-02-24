const axios = require('axios');

async function scrapeX402Bazaar() {
  console.log('  [x402 Bazaar] Fetching services from CDP discovery API...');
  
  try {
    // CDP Facilitator Discovery Endpoint (official Coinbase endpoint)
    var response = await axios.get('https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources', {
      params: {
        type: 'http',
        limit: 100
      },
      headers: {
        'User-Agent': 'AgentLeads/1.0',
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    
    var items = [];
    
    // Handle response format
    if (response.data && response.data.items) {
      items = response.data.items;
    } else if (Array.isArray(response.data)) {
      items = response.data;
    }
    
    if (!Array.isArray(items) || items.length === 0) {
      console.log('  [x402 Bazaar] No services found');
      return [];
    }
    
    var opportunities = items.map(function(service) {
      // Extract price from accepts array
      var price = '0';
      var currency = 'USDC';
      var payTo = 'unknown';
      
      if (service.accepts && service.accepts.length > 0) {
        var accept = service.accepts[0];
        // Price is in atomic units (6 decimals for USDC)
        if (accept.amount) {
          price = (parseInt(accept.amount) / 1000000).toFixed(4);
        } else if (accept.maxAmountRequired) {
          price = (parseInt(accept.maxAmountRequired) / 1000000).toFixed(4);
        }
        if (accept.payTo) {
          payTo = accept.payTo;
        }
      }
      
      // Extract metadata
      var metadata = service.metadata || {};
      var description = metadata.description || '';
      
      // Create title from resource URL or metadata
      var title = metadata.name || metadata.title || description || service.resource || 'x402 Service';
      
      // Clean up title if it's a URL
      if (title.startsWith('http')) {
        try {
          var url = new URL(title);
          title = url.pathname.split('/').filter(Boolean).pop() || url.hostname;
        } catch (e) {
          title = 'x402 Service';
        }
      }
      
      return {
        source: 'x402bazaar',
        sourceUrl: 'https://x402.org',
        title: title.substring(0, 200),
        description: description.substring(0, 500),
        payout: price,
        payoutCurrency: currency,
        author: payTo,
        postUrl: service.resource || 'https://x402.org',
        category: 'service',
        status: 'active',
        deadline: '',
        scrapedAt: new Date().toISOString()
      };
    });
    
    console.log('  [x402 Bazaar] Found ' + opportunities.length + ' services');
    return opportunities;
    
  } catch (error) {
    console.error('  [x402 Bazaar] Error: ' + error.message);
    return [];
  }
}

module.exports = { scrapeX402Bazaar: scrapeX402Bazaar };