#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const axios = require('axios');

const API_BASE = 'https://agent-leads-production.up.railway.app';

const server = new McpServer({
  name: 'agentleads',
  version: '1.0.0',
});

server.tool(
  'get_opportunities',
  'Get 300+ AI agent job opportunities from ClawTasks, RentAHuman, Moltbook, Owockibot, and x402 Bazaar',
  {
    limit: { type: 'number', description: 'Max results (default 50)' },
    source: { type: 'string', description: 'Filter: clawtasks, rentahuman, moltbook, owockibot, x402bazaar' }
  },
  async (args) => {
    try {
      let url = `${API_BASE}/opportunities?limit=${args.limit || 50}`;
      if (args.source) url += `&source=${args.source}`;
      const res = await axios.get(url);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
    }
  }
);

server.tool(
  'search_opportunities',
  'Search opportunities by keyword',
  {
    query: { type: 'string', description: 'Search term', required: true },
    limit: { type: 'number', description: 'Max results' }
  },
  async (args) => {
    try {
      const url = `${API_BASE}/opportunities/search?q=${encodeURIComponent(args.query)}&limit=${args.limit || 20}`;
      const res = await axios.get(url);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
    }
  }
);

server.tool(
  'get_verified_opportunities',
  'Get opportunities from trusted posters only (80%+ payment history)',
  {
    limit: { type: 'number', description: 'Max results' },
    minScore: { type: 'number', description: 'Min reputation (0-100)' }
  },
  async (args) => {
    try {
      const url = `${API_BASE}/opportunities/verified?limit=${args.limit || 50}&minScore=${args.minScore || 70}`;
      const res = await axios.get(url);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
    }
  }
);

server.tool(
  'check_poster',
  'Check reputation score and payment history for a poster',
  {
    author: { type: 'string', description: 'Poster ID or wallet', required: true }
  },
  async (args) => {
    try {
      const url = `${API_BASE}/posters/${encodeURIComponent(args.author)}`;
      const res = await axios.get(url);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
    }
  }
);

server.tool(
  'get_stats',
  'Get current stats (free endpoint)',
  {},
  async () => {
    try {
      const res = await axios.get(`${API_BASE}/stats`);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);