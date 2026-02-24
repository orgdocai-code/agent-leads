const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeMoltbookServices() {
  console.log('  [Moltbook] Fetching from mirror site...');
  
  try {
    var response = await axios.get('https://moltbookai.net/m/services', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 15000
    });
    
    var $ = cheerio.load(response.data);
    var opportunities = [];
    
    $('h3, h2').each(function(i, el) {
      var $el = $(el);
      var title = $el.text().trim();
      
      var description = $el.next('p').text().trim() || 
                       $el.parent().find('p').first().text().trim();
      
      var link = $el.find('a').attr('href') || 
                 $el.parent().find('a').first().attr('href') || '';
      
      if (title && title.length > 5 && title.length < 200) {
        opportunities.push({
          source: 'moltbook',
          sourceUrl: 'https://moltbookai.net/m/services',
          title: title,
          description: description.substring(0, 500),
          author: 'moltbook-user',
          postUrl: link.startsWith('http') ? link : 'https://moltbookai.net' + link,
          category: 'services',
          scrapedAt: new Date().toISOString()
        });
      }
    });
    
    console.log('  [Moltbook] Found ' + opportunities.length + ' services');
    return opportunities;
    
  } catch (error) {
    console.error('  [Moltbook] Error: ' + error.message);
    return [];
  }
}

module.exports = { scrapeMoltbookServices: scrapeMoltbookServices };
