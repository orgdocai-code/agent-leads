// Owockibot Auto-Claimer & Submitter
// Monitors for new bounties and automatically claims/submits

const axios = require('axios');

const OWOCKIBOT_API = 'https://bounty.owockibot.xyz';
const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds

// Our wallet address (for claiming)
const OUR_WALLET = process.env.OUR_WALLET || '0x3eA43a05C0E3A4449785950E4d1e96310aEa3670';

// Discord webhook for notifications
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

console.log('Owockibot Auto-Monitor Starting...');
console.log('Wallet:', OUR_WALLET);

// Fetch all bounties
async function fetchBounties() {
  try {
    const res = await axios.get(`${OWOCKIBOT_API}/bounties`);
    return Array.isArray(res.data) ? res.data : res.data.data || [];
  } catch (e) {
    console.error('Error fetching bounties:', e.message);
    return [];
  }
}

// Notify via Discord
async function discordNotify(message) {
  if (!DISCORD_WEBHOOK) return;
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
    console.log('NEW OPEN BOUNTIES FOUND!');
    await discordNotify('NEW BOUNTY: ' + openBounties[0].title + ' - ' + (openBounties[0].rewardFormatted || openBounties[0].reward));
    
    for (const bounty of openBounties) {
      console.log(`- ${bounty.title} (${bounty.id}) - ${bounty.rewardFormatted || bounty.reward}`);
      await claimBounty(bounty);
    }
  }
}

// Claim a bounty
async function claimBounty(bounty) {
  console.log(`Claiming bounty ${bounty.id}...`);
  
  try {
    const res = await axios.post(`${OWOCKIBOT_API}/bounties/${bounty.id}/claim`, {
      address: OUR_WALLET
    });
    
    console.log('CLAIMED:', res.data);
    await discordNotify('CLAIMED: ' + bounty.title);
    await buildAndSubmit(bounty);
    
  } catch (e) {
    console.error('Claim failed:', e.response?.data || e.message);
  }
}

// Build solution and submit
async function buildAndSubmit(bounty) {
  console.log(`Building: ${bounty.title}`);
  console.log('AI building not yet integrated - need to add code generation');
}

// Submit work to a claimed bounty
async function submitWork(bountyId, content, proof) {
  console.log(`Submitting work for bounty ${bountyId}...`);
  
  try {
    const res = await axios.post(`${OWOCKIBOT_API}/bounties/${bountyId}/submit`, {
      content,
      proof
    });
    
    console.log('Submitted:', res.data);
    await discordNotify('SUBMITTED: ' + bountyId);
    return true;
  } catch (e) {
    console.error('Submit failed:', e.response?.data || e.message);
    return false;
  }
}

// Get platform stats
async function getStats() {
  try {
    const res = await axios.get(`${OWOCKIBOT_API}/stats`);
    console.log('Stats:', res.data);
  } catch (e) {
    console.error('Stats error:', e.message);
  }
}

// Main
async function main() {
  await checkForNewBounties();
  await getStats();
  setInterval(checkForNewBounties, CHECK_INTERVAL_MS);
}

main();
