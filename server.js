// server.js - Enhanced Dynamic Multi-Tenant WebSocket Server for Render
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const DynamicWebSocketHandler = require('./src/handlers/DynamicWebSocketHandler');
const configLoader = require('./src/services/config/ConfigurationLoader');
const apiRoutes = require('./src/routes/apiRoutes');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for Render
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Company-Id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// API Routes
app.use('/api', apiRoutes);

// Health check for Render
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Nexella Dynamic WebSocket Server',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    features: {
      calendar: !!process.env.GOOGLE_CALENDAR_ID,
      memory: !!process.env.PINECONE_API_KEY,
      multiTenant: true
    }
  });
});

// Dynamic company configuration endpoint
app.get('/health/:companyId?', async (req, res) => {
  const companyId = req.params.companyId || process.env.DEFAULT_COMPANY_ID || 'nexella_default';
  
  try {
    const config = await configLoader.loadCompanyConfig(companyId);
    res.json({
      status: 'healthy',
      company: {
        id: companyId,
        name: config.companyName,
        services: Object.keys(config.services),
        aiAgent: config.aiAgent.name
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      companyId: companyId
    });
  }
});

// Company configuration management endpoints
app.get('/api/companies', async (req, res) => {
  // In production, this would fetch from database
  const companies = await configLoader.listCompanies();
  res.json({ companies });
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
    // Validate API key for security
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    await configLoader.saveConfig(req.params.companyId, req.body);
    res.json({ success: true, message: 'Configuration updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connection handler with enhanced company detection
wss.on('connection', async (ws, req) => {
  console.log('🔗 New WebSocket connection established');
  console.log('📍 Request URL:', req.url);
  console.log('📍 Headers:', req.headers);
  
  try {
    // Extract company ID from multiple sources
    const companyId = extractCompanyId(req);
    
    if (!companyId) {
      console.error('❌ No company ID provided');
      ws.send(JSON.stringify({
        error: 'Company ID required',
        message: 'Please provide company ID via URL path, query parameter, or header'
      }));
      ws.close(1008, 'Company ID required');
      return;
    }
    
    console.log(`🏢 Initializing handler for company: ${companyId}`);
    
    // Create dynamic handler for this company
    const handler = new DynamicWebSocketHandler(ws, req, companyId);
    
    // Send initial connection success message
    ws.send(JSON.stringify({
      type: 'connection_established',
      companyId: companyId,
      message: 'Connected to Nexella AI',
      timestamp: new Date().toISOString()
    }));
    
  } catch (error) {
    console.error('❌ Error initializing connection:', error);
    ws.send(JSON.stringify({
      error: 'Initialization failed',
      message: error.message
    }));
    ws.close(1011, 'Initialization failed');
  }
});

// Enhanced company ID extraction
function extractCompanyId(req) {
  // Priority 1: From URL path (e.g., /ws/company123/call_abc)
  const pathMatch = req.url.match(/\/ws\/([^\/]+)/);
  if (pathMatch) {
    console.log('📍 Company ID from path:', pathMatch[1]);
    return pathMatch[1];
  }
  
  // Priority 2: From query string (e.g., ?company=company123)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const companyParam = url.searchParams.get('company') || url.searchParams.get('companyId');
  if (companyParam) {
    console.log('📍 Company ID from query:', companyParam);
    return companyParam;
  }
  
  // Priority 3: From custom header
  const companyHeader = req.headers['x-company-id'] || req.headers['x-nexella-company'];
  if (companyHeader) {
    console.log('📍 Company ID from header:', companyHeader);
    return companyHeader;
  }
  
  // Priority 4: From authorization token (if using JWT)
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    try {
      // Simple extraction - in production, verify JWT
      const token = authHeader.replace('Bearer ', '');
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if (payload.companyId) {
        console.log('📍 Company ID from auth token:', payload.companyId);
        return payload.companyId;
      }
    } catch (e) {
      console.log('⚠️ Could not extract company ID from auth token');
    }
  }
  
  // Priority 5: Default company (for testing)
  const defaultCompany = process.env.DEFAULT_COMPANY_ID;
  if (defaultCompany) {
    console.log('📍 Using default company ID:', defaultCompany);
    return defaultCompany;
  }
  
  return null;
}

// Graceful shutdown for Render
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing HTTP server');
  server.close(() => {
    console.log('🛑 HTTP server closed');
    
    // Close all WebSocket connections
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Dynamic Nexella AI Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🏢 Default Company: ${process.env.DEFAULT_COMPANY_ID || 'Not set'}`);
  console.log(`📁 Config Source: ${process.env.CONFIG_SOURCE || 'file'}`);
  console.log(`📅 Calendar: ${process.env.GOOGLE_CALENDAR_ID ? 'Enabled' : 'Disabled'}`);
  console.log(`🧠 Memory System: ${process.env.PINECONE_API_KEY ? 'Enabled' : 'Disabled'}`);
});
