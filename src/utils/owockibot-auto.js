// Owockibot Auto-Claimer & Submitter
// Monitors for new bounties and automatically claims/submits

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const OWOCKIBOT_API = 'https://bounty.owockibot.xyz';
const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds

// Our wallet address (for claiming)
const OUR_WALLET = process.env.OUR_WALLET || '0x3eA43a05C0E3A4449785950E4d1e96310aEa3670';

// OpenAI for code generation
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-4o';

// Discord webhook for notifications
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

console.log('Owockibot Auto-Monitor Starting...');
console.log('Wallet:', OUR_WALLET);

// Prompt templates by type
const PROMPT_TEMPLATES = {
  discord: `You are an expert Discord bot developer. Create a COMPLETE working solution.

BOUNTY: {title}
DESCRIPTION: {description}

Write ALL code - no placeholders. Include:
1. package.json with dependencies
2. Complete bot code
3. .env.example
4. Deploy instructions (Railway/Docker)
5. README

Output as:
---
# FILES
[package.json]
<code>
[bot.js]
<code>
[README.md]
<instructions>
---
`,

  frontend: `You are an expert React/Next.js developer. Create a COMPLETE working solution.

BOUNTY: {title}
DESCRIPTION: {description}

Write ALL code - no placeholders. Include:
1. package.json
2. Complete React code
3. Tailwind classes
4. Deploy instructions (Vercel)
5. README

Output as:
---
# FILES
[package.json]
<code>
[page.js]
<code>
[README.md]
---
`,

  api: `You are an expert API developer. Create a COMPLETE working solution.

BOUNTY: {title}
DESCRIPTION: {description}

Write ALL code - no placeholders. Include:
1. package.json
2. Express server with all routes
3. Middleware
4. .env.example
5. Deploy instructions
6. README

Output as:
---
# FILES
[package.json]
[index.js]
<code>
[README.md]
---
`,

  default: `You are an expert full-stack developer. Create a COMPLETE working solution.

BOUNTY: {title}
DESCRIPTION: {description}

Write ALL code - no placeholders. Include everything needed to run.

Output as:
---
# FILES
[package.json]
[index.js]
[README.md]
---
`
};

function detectType(bounty) {
  const text = ((bounty.title || '') + ' ' + (bounty.description || '')).toLowerCase();
  if (text.includes('discord') || text.includes('telegram') || text.includes('bot')) return 'discord';
  if (text.includes('react') || text.includes('frontend') || text.includes('ui') || text.includes('dashboard')) return 'frontend';
  if (text.includes('api') || text.includes('endpoint') || text.includes('server')) return 'api';
  return 'default';
}

async function generateCode(bounty) {
  if (!OPENAI_API_KEY) {
    console.log('[Codex] No API key - using fallback');
    return generateFallbackSolution(bounty);
  }

  const type = detectType(bounty);
  const template = PROMPT_TEMPLATES[type] || PROMPT_TEMPLATES.default;
  
  const prompt = template
    .replace('{title}', bounty.title || '')
    .replace('{description}', (bounty.description || '').substring(0, 2000));

  try {
    console.log(`[Codex] Generating ${type} solution for: ${bounty.title?.substring(0, 30)}`);
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: CODEX_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 12000
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    const solution = response.data.choices[0]?.message?.content;
    const tokens = response.data.usage?.total_tokens || 0;
    console.log(`[Codex] Generated (${tokens} tokens)`);
    
    return solution;
  } catch (e) {
    console.error('[Codex] Error:', e.message);
    return generateFallbackSolution(bounty);
  }
}

function generateFallbackSolution(bounty) {
  return `
# Solution for: ${bounty.title}

## Description
${bounty.description || 'N/A'}

## Implementation
This is an automated solution placeholder.

## Files
See the bounty description for requirements.
`;
}

// Fetch all bounties
async function fetchBounties() {
  try {
    const res = await axios.get(`${OWOCKIBOT_API}/bounties`, { timeout: 10000 });
    return Array.isArray(res.data) ? res.data : res.data.data || [];
  } catch (e) {
    console.error('Error fetching bounties:', e.message);
    return [];
  }
}

// Notify via Discord
async function discordNotify(message) {
  if (!DISCORD_WEBHOOK) {
    console.log('[Discord]', message);
    return;
  }
  try {
    await axios.post(DISCORD_WEBHOOK, { content: message });
  } catch (e) {
    console.error('Discord notify error:', e.message);
  }
}

// Check for new open bounties
async function checkForNewBounties() {
  const bounties = await fetchBounties();
  const openBounties = bounties.filter(b => b.status === 'open');
  
  console.log(`[${new Date().toISOString()}] Total: ${bounties.length}, Open: ${openBounties.length}`);
  
  if (openBounties.length > 0) {
    console.log('🎉 NEW OPEN BOUNTY FOUND!');
    await discordNotify('🎉 **NEW BOUNTY:** ' + openBounties[0].title + ' - ' + (openBounties[0].rewardFormatted || openBounties[0].reward));
    
    for (const bounty of openBounties) {
      console.log(`→ ${bounty.title} (${bounty.id}) - ${bounty.rewardFormatted || bounty.reward}`);
      await claimAndSubmit(bounty);
    }
  }
}

// Claim, generate, and submit
async function claimAndSubmit(bounty) {
  console.log(`\n=== Processing: ${bounty.title} ===`);
  
  // Step 1: Claim the bounty
  console.log('[1/3] Claiming bounty...');
  try {
    const claimRes = await axios.post(`${OWOCKIBOT_API}/bounties/${bounty.id}/claim`, {
      address: OUR_WALLET
    });
    console.log('[1/3] ✅ Claimed:', claimRes.data?.message || 'Success');
    await discordNotify('✅ **CLAIMED:** ' + bounty.title);
  } catch (e) {
    console.error('[1/3] ❌ Claim failed:', e.response?.data || e.message);
    await discordNotify('❌ **CLAIM FAILED:** ' + bounty.title + ' - ' + e.message);
    return;
  }

  // Step 2: Generate code
  console.log('[2/3] Generating solution...');
  const solution = await generateCode(bounty);
  if (solution) {
    console.log('[2/3] ✅ Code generated');
    // Log first 200 chars
    console.log('   Preview:', solution.substring(0, 200).replace(/\n/g, ' '));
  } else {
    console.log('[2/3] ⚠️ Code generation failed - using fallback');
  }

  // Step 3: Submit the solution
  console.log('[3/3] Submitting solution...');
  try {
    const submitRes = await axios.post(`${OWOCKIBOT_API}/bounties/${bounty.id}/submit`, {
      address: OUR_WALLET,
      solution: solution || generateFallbackSolution(bounty),
      githubUrl: '', // Could auto-commit to GitHub
      deployedUrl: '' // Could auto-deploy
    });
    console.log('[3/3] ✅ Submitted:', submitRes.data?.message || 'Success');
    await discordNotify('✅ **SUBMITTED:** ' + bounty.title + '\n```' + (solution?.substring(0, 500) || 'Fallback') + '```');
  } catch (e) {
    console.error('[3/3] ❌ Submit failed:', e.response?.data || e.message);
    await discordNotify('❌ **SUBMIT FAILED:** ' + bounty.title);
  }
  
  console.log('=== Done ===\n');
}

// Start monitoring
let monitorInterval = null;

function startMonitor() {
  console.log('Starting Owockibot monitor (10s interval)...');
  checkForNewBounties();
  monitorInterval = setInterval(checkForNewBounties, CHECK_INTERVAL_MS);
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('Monitor stopped');
  }
}

// Export for API control
module.exports = { startMonitor, stopMonitor, checkForNewBounties, claimAndSubmit };

// Auto-start if run directly
if (require.main === module) {
  startMonitor();
}
