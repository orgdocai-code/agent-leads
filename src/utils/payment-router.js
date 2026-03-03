// x402 Payment Router for AgentLeads
// This module handles receiving and forwarding payments
// Note: Using manual x402 implementation to avoid ESM issues

const axios = require('axios');

// Our wallet address
const OUR_WALLET = process.env.WALLET_ADDRESS || '0x3eA43a05C0E3A4449785950E4d1e96310aEa3670';

// Fee percentage (we keep this much)
const FEE_PERCENT = 2; // 2%

// Initialize x402 payment routes
function initX402(app) {
  // x402 payment handler
  app.post('/pay', async function(req, res) {
    try {
      const { to, amount, currency, description } = req.body;
      
      if (!to || !amount) {
        return res.status(400).json({ error: 'Missing to or amount' });
      }
      
      // Calculate our fee
      const fee = (amount * FEE_PERCENT) / 100;
      const netAmount = amount - fee;
      
      res.json({
        success: true,
        payment: {
          to: to,
          amount: netAmount.toString(),
          currency: currency || 'USDC',
          description: description || 'AgentLeads Service'
        },
        fee: fee,
        amount: amount,
        net: netAmount,
        ourWallet: OUR_WALLET
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  
  // Check payment status
  app.get('/payment/status/:id', async function(req, res) {
    try {
      const paymentId = req.params.id;
      res.json({ success: true, status: 'pending', id: paymentId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  
  // Get our wallet info
  app.get('/wallet', function(req, res) {
    res.json({
      wallet: OUR_WALLET,
      feePercent: FEE_PERCENT,
      supportedCurrencies: ['USDC'],
      network: 'base'
    });
  });
  
  // x402 manifest endpoint (for protocol compatibility)
  app.get('/.well-known/x402', function(req, res) {
    res.json({
      protocol: 'x402',
      version: '1.0',
      facilitator: 'https://facilitator.coinbase.com',
      payment: {
        scheme: 'evm-chains',
        network: 'eip155:8453', // Base
        currency: 'USDC'
      }
    });
  });
  
  console.log('[x402] Payment router initialized');
  console.log('[x402] Our wallet:', OUR_WALLET);
  console.log('[x402] Fee:', FEE_PERCENT + '%');
}

module.exports = {
  initX402: initX402,
  OUR_WALLET: OUR_WALLET,
  FEE_PERCENT: FEE_PERCENT
};
