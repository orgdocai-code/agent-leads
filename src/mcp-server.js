const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const axios = require('axios');

const API_BASE = process.env.API_URL || 'https://agent-leads-production.up.railway.app';

// Create MCP server
const server = new McpServer({
  name: 'agentleads',
  version: '1.0.0',
});

// Register tools
server.tool(
  'get_opportunities',
  'Get AI agent job opportunities from ClawTasks, RentAHuman, Moltbook, Owockibot, and x402 Bazaar',
  {
    limit: { type: 'number', description: 'Number of opportunities (max 100)', default: 50 },
    source: { type: 'string', description: 'Filter by source: clawtasks, rentahuman, moltbook, owockibot, x402bazaar' }
  },
  async (args) => {
    try {
      let endpoint = `/opportunities?limit=${args.limit || 50}`;
      if (args.source) endpoint += `&source=${args.source}`;
      const response = await axios.get(API_BASE + endpoint);
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'search_opportunities',
  'Search for opportunities by keyword',
  {
    query: { type: 'string', description: 'Search query', required: true },
    limit: { type: 'number', description: 'Number of results', default: 20 }
  },
  async (args) => {
    try {
      const endpoint = `/opportunities/search?q=${encodeURIComponent(args.query)}&limit=${args.limit || 20}`;
      const response = await axios.get(API_BASE + endpoint);
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_verified_opportunities',
  'Get opportunities only from trusted posters with high reputation scores',
  {
    limit: { type: 'number', description: 'Number of opportunities', default: 50 },
    minScore: { type: 'number', description: 'Minimum reputation score (0-100)', default: 70 }
  },
  async (args) => {
    try {
      const endpoint = `/opportunities/verified?limit=${args.limit || 50}&minScore=${args.minScore || 70}`;
      const response = await axios.get(API_BASE + endpoint);
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'verify_url',
  'Check if a URL is live and responding',
  {
    url: { type: 'string', description: 'URL to verify', required: true }
  },
  async (args) => {
    try {
      const endpoint = `/verify/url?url=${encodeURIComponent(args.url)}`;
      const response = await axios.get(API_BASE + endpoint);
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'verify_wallet',
  'Check if a wallet has ETH balance on Base network',
  {
    address: { type: 'string', description: 'Wallet address (0x...)', required: true }
  },
  async (args) => {
    try {
      const endpoint = `/verify/wallet?address=${args.address}`;
      const response = await axios.get(API_BASE + endpoint);
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'check_poster_reputation',
  'Get reputation data for a bounty poster',
  {
    author: { type: 'string', description: 'Poster ID or wallet address', required: true }
  },
  async (args) => {
    try {
      const endpoint = `/posters/${encodeURIComponent(args.author)}`;
      const response = await axios.get(API_BASE + endpoint);
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_stats',
  'Get statistics about available opportunities (free)',
  {},
  async () => {
    try {
      const response = await axios.get(API_BASE + '/stats');
      return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentLeads MCP server running');
}

main().catch(console.error);