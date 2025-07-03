// src/server.js
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const config = require('./config/environment');
const apiRoutes = require('./routes/apiRoutes');

// Handlers
const WebSocketHandler = require('./handlers/WebSocketHandler');
let WebSocketHandlerWithMemory = null;
try {
  WebSocketHandlerWithMemory = require('./handlers/WebSocketHandlerWithMemory');
  console.log('✅ Memory-enhanced handler available');
} catch (error) {
  console.log('⚠️ Memory-enhanced handler not available');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Routes
app.use('/', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    memoryEnabled: config.ENABLE_MEMORY,
    calendarConfigured: !!(config.GOOGLE_PROJECT_ID && config.GOOGLE_PRIVATE_KEY && config.GOOGLE_CLIENT_EMAIL)
  });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION ATTEMPT');
  
  // Determine which handler to use based on configuration
  let useMemoryHandler = false;
  
  if (config.ENABLE_MEMORY && WebSocketHandlerWithMemory) {
    // Check if this is a test customer
    if (config.MEMORY_TEST_MODE) {
      console.log('🧪 Memory test mode active - using memory handler');
      useMemoryHandler = true;
    }
    // Check beta customers
    else if (config.MEMORY_BETA_CUSTOMERS.length > 0) {
      // This would need the customer email, which we get later
      console.log('🌟 Beta customer check will happen after identification');
    }
    // Check rollout percentage
    else if (config.MEMORY_ROLLOUT_PERCENTAGE > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.MEMORY_ROLLOUT_PERCENTAGE) {
        console.log(`🎲 Percentage rollout (${config.MEMORY_ROLLOUT_PERCENTAGE}%) - using memory handler`);
        useMemoryHandler = true;
      } else {
        console.log(`🎲 Percentage rollout (${config.MEMORY_ROLLOUT_PERCENTAGE}%) - using standard handler`);
      }
    }
  }
  
  // Create appropriate handler
  if (useMemoryHandler && WebSocketHandlerWithMemory) {
    console.log('🧠 Initializing MEMORY-ENHANCED WebSocket handler');
    new WebSocketHandlerWithMemory(ws, req);
  } else {
    console.log('📞 Initializing REGULAR WebSocket handler');
    new WebSocketHandler(ws, req);
  }
});

// Knowledge base initialization function
async function initializeKnowledgeBase() {
  if (!config.ENABLE_MEMORY || !config.PINECONE_API_KEY) {
    console.log('⚠️ Memory system disabled, skipping knowledge base initialization');
    return;
  }

  try {
    const RAGMemoryService = require('./services/memory/RAGMemoryService');
    const memoryService = new RAGMemoryService();
    
    // Check if knowledge base has industry data
    console.log('🔍 Checking knowledge base status...');
    
    // Small delay to ensure Pinecone is ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test query to check if data exists
    const testResults = await memoryService.index.query({
      vector: new Array(3072).fill(0.1), // Dummy vector
      filter: {
        memory_type: { $eq: 'industry_solution' }
      },
      topK: 1,
      includeMetadata: true
    });
    
    if (!testResults.matches || testResults.matches.length === 0) {
      console.log('⚠️ Knowledge base empty, running ingestion...');
      
      // Run the ingestion script
      const { execSync } = require('child_process');
      try {
        execSync('node scripts/ingestIndustryKnowledge.js', { stdio: 'inherit' });
        console.log('✅ Knowledge base initialized successfully');
      } catch (error) {
        console.error('❌ Failed to run ingestion script:', error.message);
        console.log('📝 Please run manually: node scripts/ingestIndustryKnowledge.js');
      }
    } else {
      console.log('✅ Knowledge base already populated');
    }
    
  } catch (error) {
    console.error('❌ Knowledge base initialization error:', error.message);
  }
}

// Start server
const PORT = process.env.PORT || config.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  
  // Initialize calendar if credentials are available
  try {
    const { initializeCalendarService } = require('./services/calendar/CalendarHelpers');
    const initialized = await initializeCalendarService();
    
    if (initialized) {
      console.log('📅 Google Calendar integration ready');
    } else {
      console.log('📅 Running in demo mode (calendar not configured)');
    }
  } catch (error) {
    console.warn('⚠️ Calendar initialization skipped:', error.message);
    console.log('📅 Running in demo mode');
  }
  
  // Initialize knowledge base
  await initializeKnowledgeBase();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { app, server };
