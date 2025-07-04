// server.js - COMPLETE FILE WITH LEARNING SYSTEM
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const config = require('./src/config/environment');
const apiRoutes = require('./src/routes/apiRoutes');
const learningRoutes = require('./src/routes/learningRoutes');

// Handlers
const WebSocketHandler = require('./src/handlers/WebSocketHandler');
let WebSocketHandlerWithMemory = null;
let WebSocketHandlerWithLearning = null;

try {
  WebSocketHandlerWithMemory = require('./src/handlers/WebSocketHandlerWithMemory');
  console.log('✅ Memory-enhanced handler available');
} catch (error) {
  console.log('⚠️ Memory-enhanced handler not available');
}

try {
  WebSocketHandlerWithLearning = require('./src/handlers/WebSocketHandlerWithLearning');
  console.log('✅ Learning-enhanced handler available');
} catch (error) {
  console.log('⚠️ Learning-enhanced handler not available');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Add this to your server.js file to track and prevent duplicate connections

// Track active connections
const activeConnections = new Map();
const connectionCooldown = 5000; // 5 seconds between connections from same source

// WebSocket connection handler with duplicate prevention
wss.on('connection', (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION ATTEMPT');
  
  // Extract call ID and check for duplicates
  const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
  const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
  
  if (callId) {
    // Check if we already have an active connection for this call
    if (activeConnections.has(callId)) {
      const existingConnection = activeConnections.get(callId);
      const timeSinceConnection = Date.now() - existingConnection.timestamp;
      
      if (timeSinceConnection < connectionCooldown) {
        console.log(`🚫 DUPLICATE CONNECTION BLOCKED for ${callId}`);
        console.log(`   Existing connection created ${timeSinceConnection}ms ago`);
        
        // Close the duplicate connection
        ws.close(1000, 'Duplicate connection');
        return;
      }
    }
    
    // Track this connection
    activeConnections.set(callId, {
      ws: ws,
      timestamp: Date.now(),
      url: req.url
    });
    
    // Clean up when connection closes
    ws.on('close', () => {
      activeConnections.delete(callId);
      console.log(`🔌 Removed connection tracking for ${callId}`);
    });
  }
  
  // Continue with normal connection handling...
  // Determine which handler to use based on configuration
  let useMemoryHandler = false;
  let useLearningHandler = false;
  
  // Check if learning mode is enabled (highest priority)
  if (config.ENABLE_LEARNING && WebSocketHandlerWithLearning) {
    if (config.LEARNING_TEST_MODE) {
      console.log('🧠 Learning test mode active - using learning handler');
      useLearningHandler = true;
    } else if (config.LEARNING_BETA_CUSTOMERS && config.LEARNING_BETA_CUSTOMERS.length > 0) {
      // This would need the customer email, which we get later
      console.log('🌟 Beta customer check will happen after identification');
    } else if (config.LEARNING_ROLLOUT_PERCENTAGE > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.LEARNING_ROLLOUT_PERCENTAGE) {
        console.log(`🎲 Learning rollout (${config.LEARNING_ROLLOUT_PERCENTAGE}%) - using learning handler`);
        useLearningHandler = true;
      } else {
        console.log(`🎲 Learning rollout (${config.LEARNING_ROLLOUT_PERCENTAGE}%) - using standard handler`);
      }
    }
  }
  
  // If not using learning, check memory handler
  if (!useLearningHandler && config.ENABLE_MEMORY && WebSocketHandlerWithMemory) {
    if (config.MEMORY_TEST_MODE) {
      console.log('🧪 Memory test mode active - using memory handler');
      useMemoryHandler = true;
    } else if (config.MEMORY_BETA_CUSTOMERS.length > 0) {
      console.log('🌟 Beta customer check will happen after identification');
    } else if (config.MEMORY_ROLLOUT_PERCENTAGE > 0) {
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
  if (useLearningHandler && WebSocketHandlerWithLearning) {
    console.log('🧠 Initializing LEARNING-ENHANCED WebSocket handler');
    new WebSocketHandlerWithLearning(ws, req);
  } else if (useMemoryHandler && WebSocketHandlerWithMemory) {
    console.log('🧠 Initializing MEMORY-ENHANCED WebSocket handler');
    new WebSocketHandlerWithMemory(ws, req);
  } else {
    console.log('📞 Initializing REGULAR WebSocket handler');
    new WebSocketHandler(ws, req);
  }
});

// Clean up old connections periodically
setInterval(() => {
  const now = Date.now();
  const timeout = 300000; // 5 minutes
  
  for (const [callId, connection] of activeConnections.entries()) {
    if (now - connection.timestamp > timeout) {
      console.log(`🧹 Cleaning up stale connection: ${callId}`);
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close();
      }
      activeConnections.delete(callId);
    }
  }
}, 60000); // Check every minute

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
app.use('/api/learning', learningRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    memoryEnabled: config.ENABLE_MEMORY,
    learningEnabled: config.ENABLE_LEARNING,
    calendarConfigured: !!(config.GOOGLE_PROJECT_ID && config.GOOGLE_PRIVATE_KEY && config.GOOGLE_CLIENT_EMAIL)
  });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION ATTEMPT');
  
  // Determine which handler to use based on configuration
  let useMemoryHandler = false;
  let useLearningHandler = false;
  
  // Check if learning mode is enabled (highest priority)
  if (config.ENABLE_LEARNING && WebSocketHandlerWithLearning) {
    if (config.LEARNING_TEST_MODE) {
      console.log('🧠 Learning test mode active - using learning handler');
      useLearningHandler = true;
    } else if (config.LEARNING_BETA_CUSTOMERS && config.LEARNING_BETA_CUSTOMERS.length > 0) {
      // This would need the customer email, which we get later
      console.log('🌟 Beta customer check will happen after identification');
    } else if (config.LEARNING_ROLLOUT_PERCENTAGE > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.LEARNING_ROLLOUT_PERCENTAGE) {
        console.log(`🎲 Learning rollout (${config.LEARNING_ROLLOUT_PERCENTAGE}%) - using learning handler`);
        useLearningHandler = true;
      } else {
        console.log(`🎲 Learning rollout (${config.LEARNING_ROLLOUT_PERCENTAGE}%) - using standard handler`);
      }
    }
  }
  
  // If not using learning, check memory handler
  if (!useLearningHandler && config.ENABLE_MEMORY && WebSocketHandlerWithMemory) {
    if (config.MEMORY_TEST_MODE) {
      console.log('🧪 Memory test mode active - using memory handler');
      useMemoryHandler = true;
    } else if (config.MEMORY_BETA_CUSTOMERS.length > 0) {
      console.log('🌟 Beta customer check will happen after identification');
    } else if (config.MEMORY_ROLLOUT_PERCENTAGE > 0) {
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
  if (useLearningHandler && WebSocketHandlerWithLearning) {
    console.log('🧠 Initializing LEARNING-ENHANCED WebSocket handler');
    new WebSocketHandlerWithLearning(ws, req);
  } else if (useMemoryHandler && WebSocketHandlerWithMemory) {
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
    const RAGMemoryService = require('./src/services/memory/RAGMemoryService');
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

// Automatic learning job
let learningInterval = null;
if (config.ENABLE_LEARNING && config.AUTO_LEARNING_ENABLED) {
  learningInterval = setInterval(async () => {
    try {
      console.log('🧠 Running automatic learning cycle...');
      const SelfScoringLearningModule = require('./src/services/learning/SelfScoringLearningModule');
      const learningModule = new SelfScoringLearningModule();
      const results = await learningModule.learnFromHistory(config.LEARNING_MAX_HISTORY_CALLS);
      
      if (results && results.insights) {
        console.log('✅ Automatic learning completed:');
        console.log(`   Average score: ${results.insights.averageScore?.toFixed(1) || 0}`);
        console.log(`   Success rate: ${results.insights.successRate?.toFixed(1) || 0}%`);
        console.log(`   Calls analyzed: ${results.callsAnalyzed || 0}`);
        console.log(`   New strategies: ${results.strategies?.length || 0}`);
      }
    } catch (error) {
      console.error('❌ Automatic learning failed:', error.message);
    }
  }, config.LEARNING_INTERVAL);
  
  console.log(`🕐 Automatic learning scheduled every ${config.LEARNING_INTERVAL / 60000} minutes`);
}

// Start server
const PORT = process.env.PORT || config.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  
  // Initialize calendar if credentials are available
  try {
    const { initializeCalendarService } = require('./src/services/calendar/CalendarHelpers');
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
  
  // Log system configuration
  console.log('\n🔧 SYSTEM CONFIGURATION:');
  console.log('   Memory System:', config.ENABLE_MEMORY ? 'ENABLED' : 'DISABLED');
  console.log('   Learning System:', config.ENABLE_LEARNING ? 'ENABLED' : 'DISABLED');
  
  if (config.ENABLE_LEARNING) {
    console.log('   - Test Mode:', config.LEARNING_TEST_MODE);
    console.log('   - Rollout:', config.LEARNING_ROLLOUT_PERCENTAGE + '%');
    console.log('   - Auto-learning:', config.AUTO_LEARNING_ENABLED);
    console.log('   - Min Score Threshold:', config.LEARNING_MIN_SCORE_THRESHOLD);
  }
  
  console.log('\n🚀 Nexella AI WebSocket Server Ready!\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received. Shutting down gracefully...');
  
  // Clear learning interval
  if (learningInterval) {
    clearInterval(learningInterval);
    console.log('✅ Cleared learning interval');
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit the process in production
  if (process.env.NODE_ENV === 'production') {
    console.error('Continuing despite uncaught exception...');
  } else {
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process in production
  if (process.env.NODE_ENV === 'production') {
    console.error('Continuing despite unhandled rejection...');
  }
});

module.exports = { app, server };
