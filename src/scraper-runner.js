var moltbook = require('./scrapers/moltbook');
var clawtasks = require('./scrapers/clawtasks');
var rentahuman = require('./scrapers/rentahuman');
var owockibot = require('./scrapers/owockibot');
var x402bazaar = require('./scrapers/x402bazaar');
var clawlancer = require('./scrapers/clawlancer');
var clawhunt = require('./scrapers/clawhunt');
var githubBounties = require('./scrapers/github-bounties');
var remoteok = require('./scrapers/remoteok');
var multiSource = require('./scrapers/multi-source');
var database = require('./utils/database');

var SCRAPERS = [
  { name: 'Owockibot', fn: owockibot.scrapeOwockibot },
  { name: 'x402 Bazaar', fn: x402bazaar.scrapeX402Bazaar },
  { name: 'Clawlancer', fn: clawlancer.scrapeClawlancer },
  { name: 'ClawTasks', fn: clawtasks.scrapeClawTasks },
  { name: 'ClawHunt', fn: clawhunt.scrapeClawHunt },
  { name: 'RentAHuman', fn: rentahuman.scrapeRentAHuman },
  { name: 'Moltbook', fn: moltbook.scrapeMoltbookServices },
  { name: 'GitHub Bounties', fn: githubBounties.scrapeGitHubBounties },
  { name: 'RemoteOK', fn: remoteok.scrapeRemoteOK },
  { name: 'Multi-Source', fn: multiSource.searchAllSources },
];

async function runAllScrapers() {
  var startTime = Date.now();
  
  console.log('\n========================================');
  console.log('  SCRAPE STARTED: ' + new Date().toISOString());
  console.log('========================================\n');
  
  var results = { total: 0, inserted: 0, errors: 0, bySource: {} };
  
  for (var i = 0; i < SCRAPERS.length; i++) {
    var scraper = SCRAPERS[i];
    try {
      var data = await scraper.fn();
      
      var inserted = 0;
      for (var j = 0; j < data.length; j++) {
        try {
          database.insertOpportunity(data[j]);
          inserted++;
        } catch (e) {
          results.errors++;
        }
      }
      
      results.bySource[scraper.name] = { scraped: data.length, inserted: inserted };
      results.total += data.length;
      results.inserted += inserted;
      
    } catch (error) {
      console.error('  [' + scraper.name + '] FAILED: ' + error.message);
      results.bySource[scraper.name] = { error: error.message };
    }
    
    await new Promise(function(r) { setTimeout(r, 2000); });
  }
  
  var duration = ((Date.now() - startTime) / 1000).toFixed(2);
  var stats = database.getStats();
  
  console.log('\n========================================');
  console.log('  SCRAPE COMPLETE');
  console.log('========================================');
  console.log('  Duration: ' + duration + 's');
  console.log('  Scraped: ' + results.total);
  console.log('  New entries: ' + results.inserted);
  console.log('  Duplicates/Errors: ' + results.errors);
  console.log('  Total in database: ' + stats.total);
  console.log('========================================\n');
  
  return results;
}

if (require.main === module) {
  runAllScrapers()
    .then(function() { process.exit(0); })
    .catch(function(err) {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runAllScrapers: runAllScrapers };