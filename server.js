// server.js - BASED ON YOUR WORKING CODE PATTERN
require('dotenv').config();
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
  console.log('✅ Memory handler loaded');
} catch (error) {
  console.log('📞 Memory handler not found - using regular handler only');
}

// Document Ingestion Service for Knowledge Base
let DocumentIngestionService = null;
try {
  DocumentIngestionService = require('./src/services/memory/DocumentIngestionService');
  console.log('✅ Document ingestion service loaded');
} catch (error) {
  console.log('📚 Document ingestion service not found - knowledge features disabled');
}

// Initialize Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(express.json());

// EXACT COPY: Ensure we have the required environment variables (from working code)
if (!process.env.TRIGGER_SERVER_URL) {
  process.env.TRIGGER_SERVER_URL = 'https://trigger-server-qt7u.onrender.com';
}
if (!process.env.N8N_WEBHOOK_URL) {
  process.env.N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
}

// EXACT COPY: Store the latest Typeform submission for reference (from working code)
global.lastTypeformSubmission = null;

// Validate configuration
const validation = config.validate();
console.log('🔧 Environment validation:', validation);

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
    hash = hash & hash;
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

// =======================================
// NEXELLA.IO KNOWLEDGE BASE ENDPOINTS (simplified)
// =======================================

if (ingestionService) {
  // Ingest REAL Nexella.io company knowledge
  app.post('/admin/ingest/nexella-knowledge', async (req, res) => {
    try {
      console.log('🏢 Ingesting REAL Nexella.io company knowledge...');
      
      const REAL_NEXELLA_FAQS = [
        {
          question: "What is Nexella AI?",
          answer: "Nexella AI is an AI-driven Revenue Rescue System that automates lead response, customer follow-ups, and support to help businesses close more deals, recover wasted leads, and slash support costs. We guarantee measurable results within 30 days or it's free.",
          category: "company_overview"
        },
        {
          question: "What services does Nexella AI provide?",
          answer: "Nexella AI provides SMS Revive (texting dead leads), AI Voice Calls, AI Texting, Appointment Bookings, SMS Follow-Ups, AI Voice Call Follow-UPS, Monthly Reports, CRM Integration, and Review Collector.",
          category: "services"
        },
        {
          question: "How fast is your response time?",
          answer: "Our AI Systems respond to leads immediately or we can set a delay to your liking.",
          category: "performance"
        },
        {
          question: "Will you book my appointments to my calendar?",
          answer: "Our AI systems will text/call your leads, follow up, collect information and book your appointments automatically to your calendar.",
          category: "features"
        },
        {
          question: "Can your service ask questions to qualify leads?",
          answer: "Yes, we can add a string of questions to qualify leads. You tell us exactly what you need and we will train our AI to speak your company's language.",
          category: "features"
        },
        {
          question: "Do I need to bring my own Twilio and other APIs?",
          answer: "No, when you create an account with Nexella AI, the Platform, Voice, LLM, Transcription and Telephony systems are already included. We focus on bringing a centralized solution for lightning speed deployments and best results.",
          category: "technical"
        },
        {
          question: "Can I use my number for outgoing calls with Nexella AI?",
          answer: "Yes. Nexella AI allows you to import your Caller ID for free",
          category: "features"
        }
      ];
      
      const faqResult = await ingestionService.ingestFAQs(REAL_NEXELLA_FAQS);
      
      res.json({
        success: true,
        message: 'REAL Nexella.io knowledge base ingested successfully',
        results: {
          faqs: faqResult
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

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
}

// Memory System Health Check Endpoint
app.get('/health/memory', async (req, res) => {
  try {
    if (config.ENABLE_MEMORY && WebSocketHandlerWithMemory) {
      try {
        const RAGMemoryService = require('./src/services/memory/RAGMemoryService');
        const memoryService = new RAGMemoryService();
        
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

// =======================================
// WEBSOCKET CONNECTION HANDLER (BASED ON WORKING CODE)
// =======================================

// EXACT COPY: WebSocket connection handler from working code
wss.on('connection', async (ws, req) => {
  try {
    console.log('🔗 NEW WEBSOCKET CONNECTION ATTEMPT');
    
    // Decide which handler to use based on memory system settings
    const useMemory = shouldUseMemoryHandler(req);
    
    if (useMemory) {
      console.log('🧠 Initializing MEMORY-ENHANCED WebSocket handler');
      new WebSocketHandlerWithMemory(ws, req);
    } else {
      console.log('📞 Initializing REGULAR WebSocket handler');
      new WebSocketHandler(ws, req);
    }
    
  } catch (error) {
    console.error('❌ Error creating WebSocket handler:', error.message);
    
    // Try fallback to regular handler
    try {
      console.log('🔄 Falling back to regular handler');
      new WebSocketHandler(ws, req);
    } catch (fallbackError) {
      console.error('❌ Fallback handler also failed:', fallbackError.message);
      ws.close(1011, 'Handler initialization failed');
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

// =======================================
// SERVER STARTUP & INITIALIZATION
// =======================================

const PORT = config.PORT;
server.listen(PORT, async () => {
  // Determine if we're in production or development
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
  const host = isProduction ? process.env.RENDER_EXTERNAL_URL || 'https://your-app.onrender.com' : 'localhost';
  
  console.log('🚀 NEXELLA AI SERVER STARTING...');
  console.log(`✅ Server listening on port ${PORT}`);
  
  if (isProduction) {
    console.log(`🌐 Production Server URL: ${host}`);
    console.log(`🔗 Production WebSocket URL: ${host.replace('https:', 'wss:')}`);
    console.log(`🚀 Server is LIVE and accessible 24/7!`);
  } else {
    console.log(`🌐 Development Server URL: http://localhost:${PORT}`);
    console.log(`🔗 Development WebSocket URL: ws://localhost:${PORT}`);
  }
  
  // Memory System Status
  if (config.ENABLE_MEMORY) {
    if (WebSocketHandlerWithMemory) {
      console.log('🧠 MEMORY SYSTEM: ENABLED ✅');
      console.log('📚 AI agents have access to:');
      console.log('   ✓ Customer conversation history');
      console.log('   ✓ Company knowledge base');
      console.log('   ✓ Previous interaction context');
      console.log('   ✓ Personalized responses');
      
      if (config.MEMORY_TEST_MODE) {
        console.log('🧪 Memory Test Mode: ACTIVE');
      }
      if (config.MEMORY_BETA_CUSTOMERS.length > 0) {
        console.log(`🌟 Beta Customers: ${config.MEMORY_BETA_CUSTOMERS.length} customers`);
      }
      if (config.MEMORY_ROLLOUT_PERCENTAGE > 0) {
        console.log(`🎲 Memory Rollout: ${config.MEMORY_ROLLOUT_PERCENTAGE}% of traffic`);
      }
    } else {
      console.log('🧠 Memory System: ENABLED but handler missing ⚠️');
      console.log('💡 Add WebSocketHandlerWithMemory.js to enable memory features');
    }
  } else {
    console.log('📞 Memory System: DISABLED');
    console.log('💬 AI agents use standard conversation flow');
  }
  
  // Knowledge System Status
  if (ingestionService) {
    console.log('📚 KNOWLEDGE SYSTEM: ENABLED ✅');
    console.log('🏢 Real Nexella.io knowledge available');
    console.log(`🔗 Admin endpoints:`);
    console.log(`   📤 Ingest knowledge: ${isProduction ? host : 'http://localhost:' + PORT}/admin/ingest/nexella-knowledge`);
    console.log(`   🔍 Search knowledge: ${isProduction ? host : 'http://localhost:' + PORT}/admin/search/knowledge?q=pricing`);
  } else {
    console.log('📚 Knowledge System: DISABLED');
  }
  
  // Initialize Google Calendar service
  try {
    console.log('🗓️ Initializing Google Calendar service...');
    
    calendarInitialized = await initializeCalendarService();
    
    if (calendarInitialized) {
      console.log('✅ GOOGLE CALENDAR: CONNECTED ✅');
      console.log('📅 Real appointment booking available');
    } else {
      console.log('⚠️ GOOGLE CALENDAR: DISABLED ⚠️');
      console.log('📅 Add Google Calendar environment variables for real scheduling');
    }
    
  } catch (error) {
    console.error('❌ Calendar initialization error:', error.message);
    console.log('📅 CALENDAR STATUS: ERROR ❌');
  }
  
  // Final startup summary
  console.log('');
  console.log('🎉 NEXELLA AI SERVER READY!');
  console.log('');
  console.log('📋 SYSTEM STATUS SUMMARY:');
  console.log(`   📞 WebSocket Handler: ACTIVE (Based on working code)`);
  console.log(`   🧠 Memory System: ${config.ENABLE_MEMORY && WebSocketHandlerWithMemory ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   📚 Knowledge System: ${ingestionService ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   📅 Calendar Integration: ${calendarInitialized ? 'CONNECTED' : 'DISABLED'}`);
  console.log(`   🌐 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log('');
  
  // IMPORTANT: Connection acceptance (no strict validation like working code)
  console.log('🔓 CONNECTION POLICY: ALLOW ALL (like working code)');
  console.log('🔄 Customer data will be fetched from:');
  console.log('   ✓ Trigger server endpoints');
  console.log('   ✓ WebSocket metadata');
  console.log('   ✓ Global Typeform submissions');
  console.log('   ✓ URL parameters');
  console.log('');
  
  if (isProduction) {
    console.log('🚀 PRODUCTION READY - Server accessible worldwide!');
    console.log('✅ All systems operational - AI will start talking immediately!');
  } else {
    console.log('💻 Development server ready for testing');
    console.log('🎙️ AI should greet users automatically like working code');
  }
});
