const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-4o';

// Enhanced prompts with deployment instructions
const PROMPT_TEMPLATES = {
  discord: `You are an expert Discord/Telegram bot developer. Create a COMPLETE, DEPLOYABLE solution.

BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}

STRICT REQUIREMENTS:
1. Write EVERY LINE of code - no placeholders
2. Include package.json with exact dependencies
3. Add .env.example with all needed variables
4. Create deploy.sh script for Railway/Vercel deployment
5. Add Dockerfile for container deployment
6. Include health check endpoint
7. Add error handling and logging
8. Write README with step-by-step deployment

DEPLOYMENT METHODS TO INCLUDE:
- Railway.app (easiest)
- Docker + fly.io
- Local development

OUTPUT FORMAT:
---
# FILES
[package.json]
<complete with scripts, dependencies, engines>
[.env.example]
<all environment variables>
[index.js]
<complete bot code with all commands>
[deploy.sh]
<deployment script>
[Dockerfile]
<dockerfile if applicable>
[README.md]
<full deployment guide>
---
`,

  frontend: `You are an expert React/Next.js developer. Create a COMPLETE, PRODUCTION-READY frontend.

BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}

STRICT REQUIREMENTS:
1. Write EVERY LINE of code - no placeholders
2. Use TypeScript with proper types
3. Use Tailwind CSS (not external CSS files)
4. Include next.config.js for optimization
5. Add environment variables handling
6. Create Dockerfile for container deployment
7. Include Vercel deployment instructions
8. Add error boundaries
9. Implement proper loading states

DEPLOYMENT:
- Vercel (recommended): vercel deploy --prod
- Docker: docker build -t app .
- Railway: drag & drop or GitHub integration

OUTPUT FORMAT:
---
# FILES
[package.json]
[tsconfig.json]
[tailwind.config.ts]
[next.config.js]
[app/page.tsx]
[app/layout.tsx]
[app/globals.css]
[.env.example]
[Dockerfile]
[README.md]
---
`,

  plugin: `You are an expert AI plugin developer (OpenClaw, ElizaOS, Claude, etc). Create a COMPLETE, WORKING plugin.

BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}

STRICT REQUIREMENTS:
1. Write EVERY LINE of code
2. Create proper SKILL.md manifest
3. Include all required exports
4. Add configuration schema
5. Include example usage
6. Write tests if applicable
7. Document installation steps

PLATFORM OPTIONS:
- OpenClaw: SKILL.md + index.js
- ElizaOS: plugin.json + src/index.ts
- Claude: .md files + code

OUTPUT FORMAT:
---
# FILES
[SKILL.md]
<manifest with name, description, triggers, actions>
[index.js]
<complete plugin code>
[config.json]
<configuration schema>
[README.md]
<installation and usage>
---
`,

  api: `You are an expert backend API developer. Create a COMPLETE, PRODUCTION-READY REST API.

BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}

STRICT REQUIREMENTS:
1. Write EVERY LINE of code - no placeholders
2. Use Express.js or Fastify
3. Add proper middleware (cors, helmet, rate-limit)
4. Include input validation with joi/zod
5. Add error handling middleware
6. Create proper .env.example
7. Include Docker setup
8. Add health check /metrics endpoints
9. Include database migrations if needed
10. Write unit tests structure

DEPLOYMENT:
- Railway: npm run start
- Fly.io: docker build -t api .
- Render: connect GitHub

OUTPUT FORMAT:
---
# FILES
[package.json]
[src/index.js]
<server with all routes>
[src/routes/*.js]
<route handlers>
[src/middleware/*.js]
<middleware>
[.env.example]
[Dockerfile]
[docker-compose.yml]
[README.md]
---
`,

  mobile: `You are an expert React Native / mobile developer. Create a COMPLETE, DEPLOYABLE mobile app.

BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}

STRICT REQUIREMENTS:
1. Write EVERY LINE of code
2. Use Expo (easiest deployment)
3. Include all screens and navigation
4. Add proper TypeScript types
5. Include app.json with configuration
6. Add environment handling
7. Include icons and splash screen config

DEPLOYMENT:
- Expo: eas build -p ios --profile production
- EAS Update for over-the-air updates

OUTPUT FORMAT:
---
# FILES
[package.json]
[app.json]
[App.tsx]
[src/screens/*.tsx]
[src/components/*.tsx]
[src/navigation/*.tsx]
[.env.example]
[README.md]
---
`,

  default: `You are an expert full-stack developer. Create a COMPLETE, PRODUCTION-READY solution.

BOUNTY: {title}
DESCRIPTION: {description}
REQUIREMENTS: {requirements}

STRICT REQUIREMENTS:
1. Write EVERY LINE of code - complete, working implementation
2. Include all necessary files (not just main)
3. Add proper error handling
4. Include configuration management
5. Add Docker support
6. Write clear README with deployment steps

DEPLOYMENT OPTIONS:
- Railway (easiest)
- Vercel (frontend)
- Fly.io (Docker)
- Render

OUTPUT FORMAT:
---
# FILES
[package.json]
[main file with complete code]
[.env.example]
[Dockerfile]
[docker-compose.yml]
[README.md]
<deployment guide>
---
`
};

function detectType(bounty) {
  const text = (bounty.title + ' ' + bounty.description).toLowerCase();
  
  if (text.includes('discord') || text.includes('telegram') || text.includes('bot')) return 'discord';
  if (text.includes('react') || text.includes('next') || text.includes('frontend') || text.includes('ui') || text.includes('dashboard') || text.includes('web')) return 'frontend';
  if (text.includes('plugin') || text.includes('skill') || text.includes('eliza') || text.includes('openclaw') || text.includes('claude')) return 'plugin';
  if (text.includes('api') || text.includes('endpoint') || text.includes('server') || text.includes('backend')) return 'api';
  if (text.includes('mobile') || text.includes('ios') || text.includes('android') || text.includes('react native')) return 'mobile';
  
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
    .replace('{description}', (bounty.description || '').substring(0, 2000))
    .replace('{requirements}', (bounty.requirements || []).join(', ') || 'None specified');

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: CODEX_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 16000
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const code = response.data.choices[0]?.message?.content;
    const tokens = response.data.usage?.total_tokens || 0;
    
    console.log(`[Codex:${type}] Generated for:`, bounty.title?.substring(0, 30), `(${tokens} tokens)`);
    
    return { 
      code, 
      type, 
      tokens,
      deployment: getDeploymentInstructions(type)
    };
  } catch (e) {
    console.error('[Codex] Error:', e.message);
    return null;
  }
}

function getDeploymentInstructions(type) {
  const instructions = {
    discord: `
## Quick Deploy
\`\`\`bash
# Railway
railway init
railway up

# Or Docker
docker build -t discord-bot .
docker run -d --env-file .env discord-bot
\`\`\`
`,
    frontend: `
## Quick Deploy
\`\`\`bash
# Vercel (recommended)
npm i -g vercel
vercel --prod

# Or Docker
docker build -t frontend .
docker run -p 3000:3000 frontend
\`\`\`
`,
    api: `
## Quick Deploy
\`\`\`bash
# Railway
railway up

# Docker
docker build -t api .
docker run -p 3000:3000 --env-file .env api
\`\`\`
`,
    plugin: `
## Quick Install
Copy the files to your AI agent's skills directory and restart.
`
  };
  
  return instructions[type] || instructions.default || '';
}

module.exports = { generateCode, detectType };
