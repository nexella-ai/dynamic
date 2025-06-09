// server.js - Main Server Entry Point (UPDATED WITH CUSTOMER DATA VALIDATION)
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

// Document Ingestion Service for Knowledge Base
let DocumentIngestionService = null;
try {
  DocumentIngestionService = require('./src/services/memory/DocumentIngestionService');
} catch (error) {
  console.log('📚 Document ingestion service not found - knowledge features disabled');
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

// CUSTOMER DATA VALIDATION FUNCTIONS

function validateCustomerData(req) {
  console.log('🔍 VALIDATING CUSTOMER DATA...');
  
  // Check global Typeform submission
  if (global.lastTypeformSubmission && global.lastTypeformSubmission.email) {
    console.log('✅ Valid Typeform data found:', global.lastTypeformSubmission.email);
    return {
      isValid: true,
      source: 'typeform',
      email: global.lastTypeformSubmission.email,
      name: global.lastTypeformSubmission.name
    };
  }
  
  // Check URL parameters
  const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
  const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
  const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
  const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
  
  if (emailFromUrl && emailFromUrl !== 'prospect@example.com') {
    console.log('✅ Valid URL parameter data found:', emailFromUrl);
    return {
      isValid: true,
      source: 'url_params',
      email: emailFromUrl,
      name: nameFromUrl,
      phone: phoneFromUrl
    };
  }
  
  // Check webhook metadata (if available)
  try {
    const { getActiveCallsMetadata } = require('./src/services/webhooks/WebhookService');
    if (getActiveCallsMetadata && typeof getActiveCallsMetadata === 'function') {
      const activeCallsMetadata = getActiveCallsMetadata();
      const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
      const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
      
      if (callId && activeCallsMetadata && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        const email = callMetadata.customer_email || callMetadata.email;
        
        if (email && email !== 'prospect@example.com') {
          console.log('✅ Valid webhook metadata found:', email);
          return {
            isValid: true,
            source: 'webhook_metadata',
            email: email,
            name: callMetadata.customer_name || callMetadata.name,
            phone: callMetadata.customer_phone || callMetadata.phone
          };
        }
      }
    }
  } catch (error) {
    console.log('⚠️ Webhook metadata check failed:', error.message);
  }
  
  console.error('❌ NO VALID CUSTOMER DATA FOUND');
  console.error('📝 Validation results:');
  console.error('   - Typeform submission:', !!global.lastTypeformSubmission);
  console.error('   - URL email param:', !!emailFromUrl);
  console.error('   - Request URL:', req.url);
  
  return {
    isValid: false,
    source: 'none',
    email: null,
    name: null,
    phone: null
  };
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
let ingestionService = null;

// Initialize ingestion service if available
if (DocumentIngestionService) {
  try {
    ingestionService = new DocumentIngestionService();
    console.log('📚 Document ingestion service initialized');
  } catch (error) {
    console.error('❌ Failed to initialize ingestion service:', error.message);
  }
}

// API Routes
app.use('/', apiRoutes);

// KNOWLEDGE BASE ADMIN ENDPOINTS

if (ingestionService) {
  // Ingest sample data for testing
  app.post('/admin/ingest/sample-data', async (req, res) => {
    try {
      console.log('🧪 Ingesting sample data...');
      
      const sampleFAQs = [
        {
          question: "What services does Nexella AI provide?",
          answer: "Nexella AI provides AI-powered call automation, lead qualification, and appointment scheduling solutions for businesses across all industries.",
          category: "services"
        },
        {
          question: "How much does it cost?",
          answer: "Our pricing starts at $500/month for up to 500 calls, $1,200/month for up to 1,500 calls, and $3,000/month for up to 5,000 calls. Custom solutions available for higher volumes.",
          category: "pricing"
        },
        {
          question: "What industries do you serve?",
          answer: "We serve healthcare, real estate, professional services, e-commerce, home services, and many other industries with customized solutions.",
          category: "general"
        },
        {
          question: "Which CRMs do you integrate with?",
          answer: "We integrate with Salesforce, HubSpot, Pipedrive, Zoho CRM, Microsoft Dynamics, and custom APIs.",
          category: "technical"
        },
        {
          question: "How quickly can we get started?",
          answer: "Most clients are up and running within 5-7 business days, including consultation, setup, integration, and testing.",
          category: "onboarding"
        }
      ];
      
      const sampleProducts = [
        {
          id: "ai-call-automation",
          name: "AI Call Automation",
          description: "AI agents that handle outbound sales calls with human-like conversations",
          features: ["Natural language processing", "CRM integration", "Real-time calendar sync", "Lead scoring"],
          pricing: "Starting at $500/month",
          targetMarket: "Small to medium businesses",
          category: "automation"
        },
        {
          id: "lead-qualification",
          name: "Lead Qualification System",
          description: "Automatically qualify prospects based on your custom criteria",
          features: ["Custom qualification questions", "Lead scoring algorithms", "Automated follow-up", "CRM integration"],
          pricing: "Starting at $300/month",
          targetMarket: "Sales teams",
          category: "qualification"
        }
      ];
      
      const faqResult = await ingestionService.ingestFAQs(sampleFAQs);
      const productResult = await ingestionService.ingestProductInfo(sampleProducts);
      const docResult = await ingestionService.ingestCompanyDocuments();
      
      res.json({
        success: true,
        message: 'Sample data ingested successfully',
        results: {
          faqs: faqResult,
          products: productResult,
          documents: docResult
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Ingest documents from knowledge-base folder
  app.post('/admin/ingest/documents', async (req, res) => {
    try {
      console.log('📚 Starting document ingestion...');
      const result = await ingestionService.ingestCompanyDocuments();
      
      res.json({
        success: result.success,
        message: result.success 
          ? `Successfully ingested ${result.documents} documents (${result.chunks} chunks)`
          : 'Document ingestion failed',
        details: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Search company knowledge
  app.get('/admin/search/knowledge', async (req, res) => {
    try {
      const { q: query, limit = 5 } = req.query;
      
      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query parameter "q" is required'
        });
      }
      
      const results = await ingestionService.searchCompanyKnowledge(query, parseInt(limit));
      
      res.json({
        success: true,
        query,
        results: results.map(r => ({
          content: r.content.substring(0, 200) + '...',
          score: r.score,
          type: r.memoryType,
          relevance: r.relevance
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get ingestion statistics
  app.get('/admin/stats/ingestion', async (req, res) => {
    try {
      const stats = await ingestionService.getIngestionStats();
      res.json({
        success: true,
        stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
}

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
          knowledgeSystemAvailable: !!ingestionService,
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

// WebSocket Connection Handler (UPDATED WITH CUSTOMER DATA VALIDATION)
wss.on('connection', async (ws, req) => {
  try {
    console.log('🔗 NEW WEBSOCKET CONNECTION ATTEMPT');
    
    // VALIDATE CUSTOMER DATA FIRST
    const customerValidation = validateCustomerData(req);
    
    if (!customerValidation.isValid) {
      console.error('❌ CONNECTION REJECTED: No valid customer data');
      ws.close(1008, 'Customer data required');
      return;
    }
    
    console.log(`✅ CUSTOMER DATA VALIDATED: ${customerValidation.email} (source: ${customerValidation.source})`);
    
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
    
    // Don't fall back - close connection if customer data is required
    if (error.message.includes('REAL_CUSTOMER_DATA_REQUIRED')) {
      console.error('❌ CLOSING CONNECTION: Real customer data required');
      ws.close(1008, 'Customer data validation failed');
    } else {
      // For other errors, try fallback to regular handler
      try {
        console.log('🔄 Falling back to regular handler');
        new WebSocketHandler(ws, req);
      } catch (fallbackError) {
        console.error('❌ Fallback handler also failed:', fallbackError.message);
        ws.close(1011, 'Handler initialization failed');
      }
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
  
  // Knowledge System Status
  if (ingestionService) {
    console.log('📚 Knowledge System: ENABLED ✅');
    console.log(`🔗 Admin endpoints available: ${host}/admin/ingest/sample-data`);
  } else {
    console.log('📚 Knowledge System: DISABLED');
  }
  
  // Customer Data Validation Status
  console.log('🔒 Customer Data Validation: ENFORCED ✅');
  console.log('📝 Connections require valid customer email from:');
  console.log('   - Typeform submissions');
  console.log('   - URL parameters (?customer_email=...)');
  console.log('   - Webhook metadata');
  console.log('   - Trigger server endpoints');
  
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
      
      // Show knowledge system status in production
      if (ingestionService) {
        console.log('📚 Knowledge-enhanced AI agent is LIVE!');
        console.log(`🔗 Ingest sample data: ${host}/admin/ingest/sample-data`);
      }
      
      console.log('🔒 SECURITY: Only connections with valid customer data accepted');
    }
    
  } catch (error) {
    console.error('❌ Server initialization error:', error.message);
    console.log('⚠️ Some features may be limited');
    console.log('📅 Calendar Status: Error ❌');
  }
});
