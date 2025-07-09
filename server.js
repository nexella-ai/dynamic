// server.js - Dynamic Multi-Tenant Version
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const DynamicWebSocketHandler = require('./src/handlers/DynamicWebSocketHandler');
const configLoader = require('./src/services/config/ConfigurationLoader');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());

// Health check with company info
app.get('/health/:companyId?', async (req, res) => {
  const companyId = req.params.companyId || process.env.DEFAULT_COMPANY_ID;
  
  try {
    const config = await configLoader.loadCompanyConfig(companyId);
    res.json({
      status: 'healthy',
      company: {
        id: companyId,
        name: config.companyName,
        services: Object.keys(config.services)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// WebSocket connection handler
wss.on('connection', async (ws, req) => {
  console.log('🔗 New WebSocket connection');
  
  // Extract company ID from URL or headers
  const companyId = extractCompanyId(req);
  
  if (!companyId) {
    console.error('❌ No company ID provided');
    ws.close(1008, 'Company ID required');
    return;
  }
  
  // Create dynamic handler for this company
  new DynamicWebSocketHandler(ws, req, companyId);
});

function extractCompanyId(req) {
  // Option 1: From URL path (e.g., /ws/premium_roofing_az/call_123)
  const pathMatch = req.url.match(/\/ws\/([^\/]+)/);
  if (pathMatch) return pathMatch[1];
  
  // Option 2: From query string (e.g., ?company=premium_roofing_az)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const companyParam = url.searchParams.get('company');
  if (companyParam) return companyParam;
  
  // Option 3: From custom header
  const companyHeader = req.headers['x-company-id'];
  if (companyHeader) return companyHeader;
  
  // Option 4: Default company
  return process.env.DEFAULT_COMPANY_ID;
}

// Company configuration management endpoints
app.get('/api/companies', async (req, res) => {
  // List all configured companies
  res.json({
    companies: ['premium_roofing_az', 'quality_roofing_tx', 'elite_roofing_ca']
  });
});

app.get('/api/companies/:companyId/config', async (req, res) => {
  try {
    const config = await configLoader.loadCompanyConfig(req.params.companyId);
    res.json(config);
  } catch (error) {
    res.status(404).json({ error: 'Company not found' });
  }
});

app.put('/api/companies/:companyId/config', async (req, res) => {
  try {
    await configLoader.saveConfig(req.params.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Dynamic Roofing AI Server running on port ${PORT}`);
  console.log(`🏢 Default Company: ${process.env.DEFAULT_COMPANY_ID || 'Not set'}`);
  console.log(`📁 Config Source: ${process.env.CONFIG_SOURCE || 'file'}`);
});
