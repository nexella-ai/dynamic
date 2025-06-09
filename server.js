// server.js - Main Server Entry Point (UPDATED WITH MEMORY SYSTEM)
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

// Configuration and Services
const config = require('./src/config/environment');
const { initializeCalendarService } = require('./src/services/calendar/CalendarHelpers');

// Routes and Handlers
const apiRoutes = require('./src/routes/apiRoutes');
const WebSocketHandler = require('./src/handlers/WebSocketHandler');

// Memory System Handler (conditional import)
let WebSocketHandlerWithMemory = null;
try {
  WebSocketHandlerWithMemory = require('./src/handlers/WebSocketHandlerWithMemory');
} catch (error) {
  console.log('📞 Memory handler not found - using regular handler only');
}

// Initialize Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(express.json());

// Validate configuration
const validation = config.validate();
console.log('🔧 Environment validation:', validation);

if (!validation.isValid) {
  console.warn('⚠️ Missing required environment variables:', validation.missing);
  console.warn('⚠️ Server may not function properly');
}

// Memory System Logic
function shouldUseMemoryHandler(req) {
  // Check if memory system is enabled
  if (!config.ENABLE_MEMORY || !WebSocketHandlerWithMemory) {
    return false;
  }
  
  // Test mode - always use memory for testing
  if (config.MEMORY_TEST_MODE) {
    console.log('🧪 Test mode - using memory handler');
    return true;
  }
  
  // Extract customer email from URL params
  const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
  const customerEmail = urlParams.get('customer_email') || urlParams.get('email');
  
  // Beta customers list
  if (customerEmail && config.MEMORY_BETA_CUSTOMERS.includes(customerEmail)) {
    console.log('🌟 Beta customer detected - using memory handler');
    return true;
  }
  
  // Percentage-based rollout
  if (config.MEMORY_ROLLOUT_PERCENTAGE > 0) {
    const hash = hashString(req.url || '');
    const percentage = hash % 100;
    
    if (percentage < config.MEMORY_ROLLOUT_PERCENTAGE) {
      console.log(`🎲 Percentage rollout (${percentage}%) - using memory handler`);
      return true;
    }
  }
  
  return false;
}

// Simple hash function for consistent percentage rollout
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Initialize services
let calendarInitialized = false;

// API Routes
app.use('/', apiRoutes);

// Memory System Health Check Endpoint
app.get('/health/memory', async (req, res) => {
  try {
    if (config.ENABLE_MEMORY && WebSocketHandlerWithMemory) {
      // Test if memory system is working
      try {
        const RAGMemoryService = require('./src/services/memory/RAGMemoryService');
        const memoryService = new RAGMemoryService();
        
        // Simple test - this will initialize the service
        const stats = await memoryService.getMemoryStats();
        
        res.json({
          memoryEnabled: true,
          memoryHealthy: true,
          testMode: config.MEMORY_TEST_MODE,
          betaCustomers: config.MEMORY_BETA_CUSTOMERS.length,
          rolloutPercentage: config.MEMORY_ROLLOUT_PERCENTAGE,
          stats: stats
        });
      } catch (memoryError) {
        res.status(500).json({
          memoryEnabled: true,
          memoryHealthy: false,
          error: memoryError.message,
          testMode: config.MEMORY_TEST_MODE
        });
      }
    } else {
      res.json({
        memoryEnabled: false,
        message: 'Memory system is disabled or not available',
        reason: !config.ENABLE_MEMORY ? 'ENABLE_MEMORY is false' : 'Handler not found'
      });
    }
  } catch (error) {
    res.status(500).json({
      memoryEnabled: false,
      error: error.message
    });
  }
});

// Admin endpoint to toggle memory system (optional)
app.post('/admin/memory/toggle', (req, res) => {
  const { enabled, percentage, betaCustomers } = req.body;
  
  try {
    if (enabled !== undefined) {
      process.env.ENABLE_MEMORY = enabled.toString();
    }
    
    if (percentage !== undefined) {
      process.env.MEMORY_ROLLOUT_PERCENTAGE = percentage.toString();
    }
    
    if (betaCustomers !== undefined) {
      process.env.MEMORY_BETA_CUSTOMERS = betaCustomers.join(',');
    }
    
    res.json({
      success: true,
      currentSettings: {
        enabled: process.env.ENABLE_MEMORY === 'true',
        percentage: parseInt(process.env.MEMORY_ROLLOUT_PERCENTAGE) || 0,
        betaCustomers: process.env.MEMORY_BETA_CUSTOMERS?.split(',') || []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// WebSocket Connection Handler (UPDATED WITH MEMORY SYSTEM)
wss.on('connection', async (ws, req) => {
  try {
    // Decide which handler to use
    const useMemory = shouldUseMemoryHandler(req);
    
    if (useMemory) {
      console.log('🧠 Initializing MEMORY-ENABLED WebSocket handler');
      new WebSocketHandlerWithMemory(ws, req);
    } else {
      console.log('📞 Initializing REGULAR WebSocket handler');
      new WebSocketHandler(ws, req);
    }
  } catch (error) {
    console.error('❌ Error creating WebSocket handler:', error.message);
    
    // Fallback to regular handler if memory handler fails
    try {
      console.log('🔄 Falling back to regular handler');
      new WebSocketHandler(ws, req);
    } catch (fallbackError) {
      console.error('❌ Fallback handler also failed:', fallbackError.message);
      ws.close();
    }
  }
});

// WebSocket Server Error Handler
wss.on('error', (error) => {
  console.error('❌ WebSocket Server Error:', error);
});

// HTTP Server Error Handler
server.on('error', (error) => {
  console.error('❌ HTTP Server Error:', error);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received. Shutting down gracefully...');
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received. Shutting down gracefully...');
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Start server and initialize services
const PORT = config.PORT;
server.listen(PORT, async () => {
  // Determine if we're in production or development
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
  const host = isProduction ? process.env.RENDER_EXTERNAL_URL || 'https://your-app.onrender.com' : 'localhost';
  const protocol = isProduction ? 'https:' : 'http:';
  const wsProtocol = isProduction ? 'wss:' : 'ws:';
  
  console.log(`✅ Nexella WebSocket Server listening on port ${PORT}`);
  
  if (isProduction) {
    console.log(`🌐 Production Server URL: ${host}`);
    console.log(`🔗 Production WebSocket URL: ${host.replace('https:', 'wss:')}`);
    console.log(`🚀 Server is LIVE and accessible 24/7 from anywhere!`);
  } else {
    console.log(`🌐 Development Server URL: http://localhost:${PORT}`);
    console.log(`🔗 Development WebSocket URL: ws://localhost:${PORT}`);
  }
  
  // Memory System Status
  if (config.ENABLE_MEMORY) {
    if (WebSocketHandlerWithMemory) {
      console.log('🧠 Memory System: ENABLED ✅');
      if (config.MEMORY_TEST_MODE) {
        console.log('🧪 Memory Test Mode: ACTIVE');
      }
      if (config.MEMORY_BETA_CUSTOMERS.length > 0) {
        console.log(`🌟 Beta Customers: ${config.MEMORY_BETA_CUSTOMERS.length} customers`);
      }
      if (config.MEMORY_ROLLOUT_PERCENTAGE > 0) {
        console.log(`🎲 Rollout: ${config.MEMORY_ROLLOUT_PERCENTAGE}% of traffic`);
      }
    } else {
      console.log('🧠 Memory System: ENABLED but handler missing ⚠️');
      console.log('💡 Add WebSocketHandlerWithMemory.js to enable memory features');
    }
  } else {
    console.log('📞 Memory System: DISABLED');
  }
  
  // Initialize Google Calendar service after server starts
  try {
    console.log('🚀 Initializing Nexella WebSocket Server...');
    
    calendarInitialized = await initializeCalendarService();
    
    if (calendarInitialized) {
      console.log('✅ Google Calendar service ready');
      console.log('📅 Calendar Status: Real Google Calendar ✅');
    } else {
      console.log('⚠️ Google Calendar service disabled - using demo mode');
      console.log('📅 Calendar Status: Demo Mode ⚠️');
      console.log('💡 Add Google Calendar environment variables for real scheduling');
    }
    
    console.log('✅ Server initialization complete');
    
    if (isProduction) {
      console.log('🎉 Production deployment successful! Server running 24/7.');
      
      // Show memory system status in production
      if (config.ENABLE_MEMORY && WebSocketHandlerWithMemory) {
        console.log('🧠 Memory-enhanced AI agent is LIVE!');
        console.log(`🔗 Test memory health: ${host}/health/memory`);
      }
    }
    
  } catch (error) {
    console.error('❌ Server initialization error:', error.message);
    console.log('⚠️ Some features may be limited');
    console.log('📅 Calendar Status: Error ❌');
  }
});
