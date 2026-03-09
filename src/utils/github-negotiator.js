// GitHub Auto-Responder with Payment Tracking
// Monitors comments and wallet for payment confirmation

const axios = require('axios');

const OUR_WALLET = '0x3eA43a05C0E3A4449785950E4d1e96310aEa3670';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-4o';

const githubAxios = axios.create({
  baseURL: 'https://api.github.com',
  headers: GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'AgentLeads' } : {}
});

// Discord notification helper
async function discordNotify(msg) {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook) return;
  try {
    await axios.post(webhook, { content: msg });
  } catch (e) { /* ignore */ }
}

// Track active negotiations
const negotiations = new Map(); // issueId -> { price, status, paid, comments }

// Keywords for different responses
const KEYWORDS = {
  ACCEPT: ['accept', 'go ahead', 'proceed', 'do it', 'lets go', 'yes', 'yep', 'sure', 'ok'],
  PAY: ['paid', 'payment', 'sent', 'transferred', 'done', 'complete'],
  PRICE: ['$', 'usd', 'dollars', 'price', 'budget', 'cost'],
  HALF: ['half now', 'milestone', 'split', '50/50']
};

// Generate initial offer comment using Codex
async function generateOfferComment(issue) {
  const prompt = `You are AgentLeads, an AI developer. Write a comment for a GitHub issue offering to fix it.

ISSUE: ${issue.title}
DESCRIPTION: ${issue.body?.substring(0, 500) || 'No description'}

Write a friendly, professional comment that:
1. Introduces yourself as an AI developer
2. Asks for their budget
3. Mentions a unique keyword they'll use to confirm
4. Explains the payment process

Include this exact keyword format: "Keyword: [random 6-char word]"
They'll use this keyword to confirm.

Keep it under 200 words.`;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: CODEX_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500
    }, {
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    return response.data.choices[0]?.message?.content;
  } catch (e) {
    // Fallback
    return `🤖 **AgentLeads - AI Developer**

I'd like to help fix this issue! 

To proceed, please reply with:
- Your budget for this fix
- Your keyword to confirm (e.g., "APPROVE123")

I'll then provide payment details and deliver the solution.`;
  }
}

// Generate response based on customer's reply using Codex
async function generateResponse(customerMessage, negotiation) {
  const prompt = `You are AgentLeads, an AI developer negotiating on GitHub.

CUSTOMER SAID: "${customerMessage}"
CURRENT STATUS: ${negotiation.status}

Respond appropriately:
- If they gave a price: Confirm it and provide payment address
- If they said accept/proceed: Provide payment details  
- If they asked about half now: Agree to 50% now, 50% after PR
- If they questioned: Address their concern professionally

Our payment address: ${OUR_WALLET}
Payment ID format: PAY-[issue number]-[random]

Keep response under 150 words. Be helpful and professional.`;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: CODEX_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400
    }, {
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    return response.data.choices[0]?.message?.content;
  } catch (e) {
    return "Thanks for your response! Let me check on the details.";
  }
}

// Extract keyword from our comment
function extractKeyword(comments) {
  const ourComment = comments.find(c => c.user.login === 'agent-leads[bot]' || c.body?.includes('AgentLeads'));
  if (ourComment) {
    const match = ourComment.body.match(/Keyword:\s*(\w+)/i);
    return match ? match[1] : null;
  }
  return null;
}

// Check if customer said accept
function detectAccept(message) {
  const lower = message.toLowerCase();
  return KEYWORDS.ACCEPT.some(k => lower.includes(k));
}

// Check if customer mentioned price
function detectPrice(message) {
  const lower = message.toLowerCase();
  return KEYWORDS.PRICE.some(k => lower.includes(k)) || /\$[\d,]/.test(message);
}

// Check if customer mentioned payment
function detectPayment(message) {
  const lower = message.toLowerCase();
  return KEYWORDS.PAY.some(k => lower.includes(k));
}

// Check if customer wants half now
function detectHalfNow(message) {
  const lower = message.toLowerCase();
  return KEYWORDS.HALF.some(k => lower.includes(k));
}

// Post comment on issue
async function postComment(owner, repo, issueNumber, body) {
  try {
    const res = await githubAxios.post(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
    return res.data;
  } catch (e) {
    console.error('[GitHub] Comment error:', e.message);
    return null;
  }
}

// Get comments on issue
async function getComments(owner, repo, issueNumber) {
  try {
    const res = await githubAxios.get(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`);
    return res.data;
  } catch (e) {
    return [];
  }
}

// Check for new comments since last check
async function checkNewComments(owner, repo, issueNumber, lastCommentId) {
  const comments = await getComments(owner, repo, issueNumber);
  const newComments = comments.filter(c => c.id > lastCommentId);
  return { comments, newComments };
}

// Check wallet for payment (simplified - would need blockchain API)
async function checkPayment(paymentId) {
  // In production, check Etherscan/Polygon API
  // For now, track via comment confirmation
  return { received: false, amount: 0 };
}

// Main monitor loop
async function monitorNegotiation(issue, owner, repo) {
  const issueId = `${owner}/${repo}#${issue.number}`;
  let negotiation = negotiations.get(issueId);
  
  if (!negotiation) {
    // First contact - post offer
    const comment = await generateOfferComment(issue);
    await postComment(owner, repo, issue.number, comment);
    
    negotiation = {
      status: 'awaiting_response',
      keyword: comment.match(/Keyword:\s*(\w+)/i)?.[1] || 'CONFIRM',
      price: null,
      paid: false,
      lastCommentId: 0,
      created: Date.now()
    };
    negotiations.set(issueId, negotiation);
    console.log(`[GitHub] Posted offer on ${issueId}, keyword: ${negotiation.keyword}`);
    await discordNotify(`📝 **NEW OFFER:** Posted on ${issueId}\nKeyword: ${negotiation.keyword}`);
    return;
  }
  
  // Check for new comments
  const { comments, newComments } = await checkNewComments(owner, repo, issue.number, negotiation.lastCommentId);
  
  if (newComments.length > 0) {
    const latestComment = newComments[newComments.length - 1];
    negotiation.lastCommentId = latestComment.id;
    
    const customerMessage = latestComment.body;
    console.log(`[GitHub] New comment on ${issueId}: ${customerMessage.substring(0, 50)}...`);
    
    // Detect intent
    if (detectAccept(customerMessage) && !negotiation.price) {
      negotiation.status = 'awaiting_price';
    } else if (detectPrice(customerMessage)) {
      // Extract price if mentioned
      const priceMatch = customerMessage.match(/\$[\d,]+/);
      if (priceMatch) {
        negotiation.price = priceMatch[0];
        negotiation.status = 'price_agreed';
      }
    } else if (detectPayment(customerMessage)) {
      negotiation.status = 'payment_pending';
    }
    
    // Generate and post response
    const response = await generateResponse(customerMessage, negotiation);
    await postComment(owner, repo, issue.number, response);
    
    // If price agreed, remind about payment
    if (negotiation.status === 'price_agreed') {
      negotiation.status = 'awaiting_payment';
    }
    
    // If payment confirmed, deliver!
    if (negotiation.status === 'payment_pending' || detectPayment(customerMessage)) {
      negotiation.status = 'delivering';
      await discordNotify(`💰 **PAYMENT CONFIRMED!** ${issue.title} - Delivering solution...`);
      return { action: 'deliver', issue, negotiation };
    }
  }
  
  return null;
}

// Export functions
module.exports = {
  monitorNegotiation,
  generateOfferComment,
  generateResponse,
  KEYWORDS,
  OUR_WALLET
};
