const axios = require('axios');
const { db, updateCompletionStatus, getTopPosters } = require('./utils/database');

// Sources that have status endpoints we can check
const CHECKABLE_SOURCES = {
  clawtasks: {
    checkUrl: (postUrl) => postUrl, // ClawTasks URLs are direct API
    parseStatus: (data) => ({
      completed: data.status === 'completed' || data.status === 'paid',
      paid: data.status === 'paid',
      amount: data.payout || data.reward || '0'
    })
  },
  rentahuman: {
    checkUrl: (postUrl) => postUrl,
    parseStatus: (data) => ({
      completed: data.status === 'completed' || data.status === 'closed',
      paid: data.paid === true,
      amount: data.amount || '0'
    })
  },
  owockibot: {
    checkUrl: (postUrl) => {
      // Convert bounty URL to API endpoint
      const match = postUrl.match(/bounty\/(\d+)/);
      if (match) return `https://bounty.owockibot.xyz/bounty/${match[1]}`;
      return postUrl;
    },
    parseStatus: (data) => ({
      completed: data.status === 'completed' || data.status === 'claimed',
      paid: data.paid === true || data.status === 'paid',
      amount: data.reward_usdc || data.reward || '0'
    })
  }
};

async function checkCompletion(postUrl, source) {
  const sourceConfig = CHECKABLE_SOURCES[source];
  if (!sourceConfig) return null;
  
  try {
    const checkUrl = sourceConfig.checkUrl(postUrl);
    const response = await axios.get(checkUrl, { timeout: 10000 });
    return sourceConfig.parseStatus(response.data);
  } catch (error) {
    // URL might be dead or format changed
    return null;
  }
}

async function runCompletionCheck() {
  console.log('========================================');
  console.log('  COMPLETION CHECK STARTED:', new Date().toISOString());
  console.log('========================================');
  
  // Get open completions that haven't been checked recently
  const openCompletions = db.prepare(`
    SELECT * FROM completions 
    WHERE status = 'open' 
    AND (checked_at IS NULL OR checked_at < datetime('now', '-1 hour'))
    LIMIT 50
  `).all();
  
  console.log(`  Checking ${openCompletions.length} open bounties...`);
  
  let completed = 0;
  let paid = 0;
  let errors = 0;
  
  for (const completion of openCompletions) {
    try {
      const result = await checkCompletion(completion.post_url, completion.source);
      
      if (result) {
        if (result.completed) {
          updateCompletionStatus(
            completion.post_url,
            'completed',
            result.paid,
            result.amount
          );
          completed++;
          if (result.paid) paid++;
          console.log(`  ✓ ${completion.source}: ${result.paid ? 'PAID' : 'COMPLETED'}`);
        } else {
          // Update check timestamp even if still open
          db.prepare(`
            UPDATE completions 
            SET checked_at = ?, check_count = check_count + 1 
            WHERE post_url = ?
          `).run(new Date().toISOString(), completion.post_url);
        }
      }
      
      // Rate limit: wait 500ms between checks
      await new Promise(r => setTimeout(r, 500));
      
    } catch (error) {
      errors++;
    }
  }
  
  console.log('========================================');
  console.log('  COMPLETION CHECK DONE');
  console.log(`  Checked: ${openCompletions.length}`);
  console.log(`  Newly completed: ${completed}`);
  console.log(`  Confirmed paid: ${paid}`);
  console.log(`  Errors: ${errors}`);
  console.log('========================================');
  
  // Show top posters
  const topPosters = getTopPosters(5);
  if (topPosters.length > 0) {
    console.log('  TOP TRUSTED POSTERS:');
    topPosters.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.author.substring(0, 20)}... - Score: ${p.reputation_score}, Paid: ${p.total_paid}/${p.total_posted}`);
    });
  }
  
  return { checked: openCompletions.length, completed, paid, errors };
}

// Run if called directly
if (require.main === module) {
  runCompletionCheck()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { runCompletionCheck, checkCompletion };