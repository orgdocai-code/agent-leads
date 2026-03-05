const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-4o';

const PROMPT_TEMPLATES = {
  discord: `You are an expert AI developer specializing in Discord bots and Telegram integrations.
Generate a COMPLETE, PRODUCTION-READY solution:
BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}
Generate: 1. Complete working code 2. All necessary files 3. README with setup 4. Deployment instructions

Format: --- # FILES [filename1.js] <code> [README.md] <docs> ---`,
  
  frontend: `You are an expert frontend developer specializing in React, Next.js, and modern UI.
Generate a COMPLETE, PRODUCTION-READY solution:
BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}
Generate: 1. Complete component code 2. TypeScript types 3. Tailwind styling 4. README

Format: --- # FILES [App.tsx] <code> [README.md] <docs> ---`,
  
  plugin: `You are an expert developer creating plugins for AI platforms.
Generate a COMPLETE, WORKING plugin:
BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}
Generate: 1. SKILL.md manifest 2. Complete plugin code 3. README

Format: --- # FILES [index.js] <code> [README.md] <docs> ---`,
  
  api: `You are an expert backend developer specializing in APIs and microservices.
Generate a COMPLETE, PRODUCTION-READY API:
BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}
Generate: 1. Express server 2. All routes 3. README with API docs 4. .env.example

Format: --- # FILES [server.js] <code> [README.md] <docs> ---`,
  
  default: `You are an expert AI developer. Generate a complete, working solution.
BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}
Generate: 1. Working implementation 2. Error handling 3. README with setup

Format: --- # FILES [main.js] <code> [README.md] <docs> ---`
};

function detectType(bounty) {
  const text = (bounty.title + ' ' + bounty.description).toLowerCase();
  if (text.includes('discord') || text.includes('telegram') || text.includes('bot')) return 'discord';
  if (text.includes('frontend') || text.includes('ui') || text.includes('dashboard') || text.includes('react')) return 'frontend';
  if (text.includes('plugin') || text.includes('skill') || text.includes('eliza') || text.includes('openclaw')) return 'plugin';
  if (text.includes('api') || text.includes('endpoint') || text.includes('server')) return 'api';
  return 'default';
}

async function generateCode(bounty) {
  if (!OPENAI_API_KEY) {
    console.log('[Codex] No API key configured');
    return null;
  }
  
  const type = detectType(bounty);
  const template = PROMPT_TEMPLATES[type] || PROMPT_TEMPLATES.default;
  
  const prompt = template
    .replace('{title}', bounty.title || '')
    .replace('{description}', (bounty.description || '').substring(0, 1500))
    .replace('{requirements}', (bounty.requirements || []).join(', ') || 'None specified');

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: CODEX_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 12000
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const code = response.data.choices[0]?.message?.content;
    console.log(`[Codex:${type}] Generated for:`, bounty.title?.substring(0, 30));
    return { code, type, tokens: response.data.usage?.total_tokens || 0 };
  } catch (e) {
    console.error('[Codex] Error:', e.message);
    return null;
  }
}

module.exports = { generateCode, detectType };
