// server.js - STRICT REAL CUSTOMER DATA VALIDATION + REAL NEXELLA KNOWLEDGE
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
  console.error('❌ CRITICAL: Missing required environment variables:', validation.missing);
  console.error('❌ Server cannot function without proper configuration');
  // Don't exit in development, but warn heavily
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// ================================
// STRICT CUSTOMER DATA VALIDATION
// ================================

function validateCustomerData(req) {
  console.log('🔍 STRICT CUSTOMER DATA VALIDATION STARTING...');
  
  // List of fake/demo emails to reject
  const FAKE_EMAILS = [
    'prospect@example.com',
    'test@test.com',
    'demo@demo.com',
    'fake@fake.com',
    'sample@sample.com'
  ];
  
  function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    
    const cleanEmail = email.toLowerCase().trim();
    
    // Reject specific fake emails
    if (FAKE_EMAILS.includes(cleanEmail)) {
      console.error('❌ REJECTED: Specific fake email detected:', cleanEmail);
      return false;
    }
    
    // Reject domains that are clearly fake
    const fakeDomains = ['example.com', 'test.com', 'demo.com', 'fake.com', 'sample.com'];
    const domain = cleanEmail.split('@')[1];
    if (domain && fakeDomains.includes(domain)) {
      console.error('❌ REJECTED: Fake domain detected:', domain);
      return false;
    }
    
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      console.error('❌ REJECTED: Invalid email format:', cleanEmail);
      return false;
    }
    
    return true;
  }
  
  // Method 1: Check global Typeform submission (highest priority)
  if (global.lastTypeformSubmission && global.lastTypeformSubmission.email) {
    const email = global.lastTypeformSubmission.email;
    
    if (isValidEmail(email)) {
      console.log('✅ Valid Typeform data found:', email);
      return {
        isValid: true,
        source: 'typeform',
        email: email.toLowerCase().trim(),
        name: global.lastTypeformSubmission.name || '',
        phone: global.lastTypeformSubmission.phone || ''
      };
    }
  }
  
  // Method 2: Check URL parameters
  const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
  const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
  const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
  const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
  
  if (emailFromUrl && isValidEmail(emailFromUrl)) {
    console.log('✅ Valid URL parameter data found:', emailFromUrl);
    return {
      isValid: true,
      source: 'url_params',
      email: emailFromUrl.toLowerCase().trim(),
      name: nameFromUrl || '',
      phone: phoneFromUrl || ''
    };
  }
  
  // Method 3: Check webhook metadata (if available)
  try {
    const { getActiveCallsMetadata } = require('./src/services/webhooks/WebhookService');
    if (getActiveCallsMetadata && typeof getActiveCallsMetadata === 'function') {
      const activeCallsMetadata = getActiveCallsMetadata();
      const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
      const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
      
      if (callId && activeCallsMetadata && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        const email = callMetadata.customer_email || callMetadata.email;
        
        if (email && isValidEmail(email)) {
          console.log('✅ Valid webhook metadata found:', email);
          return {
            isValid: true,
            source: 'webhook_metadata',
            email: email.toLowerCase().trim(),
            name: callMetadata.customer_name || callMetadata.name || '',
            phone: callMetadata.customer_phone || callMetadata.phone || ''
          };
        }
      }
    }
  } catch (error) {
    console.log('⚠️ Webhook metadata check failed:', error.message);
  }
  
  console.error('❌ STRICT VALIDATION FAILED: NO VALID CUSTOMER DATA FOUND');
  console.error('📝 Validation results:');
  console.error('   - Typeform submission valid:', global.lastTypeformSubmission ? isValidEmail(global.lastTypeformSubmission.email) : false);
  console.error('   - URL email param valid:', emailFromUrl ? isValidEmail(emailFromUrl) : false);
  console.error('   - Request URL:', req.url);
  console.error('🚫 CONNECTION WILL BE REJECTED - REAL CUSTOMER DATA REQUIRED');
  
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
  
  // Test mode - always use memory for testing (only with valid customer data)
  if (config.MEMORY_TEST_MODE) {
    console.log('🧪 Test mode - using memory handler');
    return true;
  }
  
  // Extract customer email from URL params
  const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
  const customerEmail = urlParams.get('customer_email') || urlParams.get('email');
  
  // Beta customers list (only with valid customer data)
  if (customerEmail && config.MEMORY_BETA_CUSTOMERS.includes(customerEmail)) {
    console.log('🌟 Beta customer detected - using memory handler');
    return true;
  }
  
  // Percentage-based rollout (only with valid customer data)
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

// =======================================
// REAL NEXELLA.IO KNOWLEDGE BASE
// =======================================

if (ingestionService) {
  // Ingest REAL Nexella.io company knowledge
  app.post('/admin/ingest/nexella-knowledge', async (req, res) => {
    try {
      console.log('🏢 Ingesting REAL Nexella.io company knowledge...');
      
      const REAL_NEXELLA_FAQS = [
        // Company Overview (from actual website)
        {
          question: "What is Nexella AI?",
          answer: "Nexella AI is an AI-driven Revenue Rescue System that automates lead response, customer follow-ups, and support to help businesses close more deals, recover wasted leads, and slash support costs. We guarantee measurable results within 30 days or it's free.",
          category: "company_overview"
        },
        {
          question: "What is your main value proposition?",
          answer: "We help businesses stop bleeding sales by automating their lead response, customer follow-ups, and support. Our guarantee is 'Book 30% More In 30 Days Or Your Money Back.' We solve the problem that the average business loses 50% of leads due to slow response times.",
          category: "value_proposition"
        },
        {
          question: "What services does Nexella AI provide?",
          answer: "Nexella AI provides SMS Revive (texting dead leads), AI Voice Calls, AI Texting, Appointment Bookings, SMS Follow-Ups, AI Voice Call Follow-UPS, Monthly Reports, CRM Integration, and Review Collector.",
          category: "services"
        },
        
        // Specific Services (from actual website)
        {
          question: "What is SMS Revive?",
          answer: "SMS Revive is our SMS system that will text your dead leads and revive them, resulting in booked appointments from low interest customers.",
          category: "services"
        },
        {
          question: "How do your AI Voice Calls work?",
          answer: "Our human-like AI will call your customers, log every detail, and schedule appointments for you. We also offer AI Voice Call Follow-UPS where our human-like AI will call and follow-up with your customers to make sure we close on them.",
          category: "services"
        },
        {
          question: "What is AI Texting?",
          answer: "Our Texting App integrates directly or extends from your website so customers can receive immediate info and book from a human-like agent.",
          category: "services"
        },
        {
          question: "Do you handle appointment bookings?",
          answer: "Yes, our AI Systems will book your appointments hands-free for you.",
          category: "services"
        },
        {
          question: "What kind of follow-ups do you provide?",
          answer: "We provide both SMS Follow-Ups (SMS Flows that follow-up on leads making sure they don't lose interest and close) and AI Voice Call Follow-UPS (human-like AI calls to follow-up with customers).",
          category: "services"
        },
        
        // Success Stories (from actual website)
        {
          question: "Do you have any success stories?",
          answer: "Yes! We took Retroshot from $10k/mo to over $200k/mo in 6 months using our SMS Flows, AI sales assistants, and Ad Strategies. We also took Nebula Orb from $25k/mo to over $250k/mo in 8 months using our SMS Flows, AI sales assistants, AI Voice Call, AI Texting, SMS Revive, and Ad Strategies.",
          category: "success_stories"
        },
        
        // Plans (from actual website - no specific pricing shown)
        {
          question: "What plans do you offer?",
          answer: "We offer three plans: Basic (includes SMS Revive, AI Chatbot, Appointment Booking, CRM Integration, Monthly reports), Pro (most popular - includes everything in Basic plus AI Voice Call, AI Voice Call Follow Ups, SMS Follow Ups, Pre Qualification Flows), and Performance Based (includes everything in Pro plus additional features).",
          category: "pricing"
        },
        {
          question: "How much does Nexella AI cost?",
          answer: "We offer custom pricing based on your specific needs. Contact us for a personalized quote. We have Basic, Pro, and Performance Based plans available with yearly billing options.",
          category: "pricing"
        },
        
        // Technical Features
        {
          question: "Do you integrate with CRMs?",
          answer: "Yes, we easily integrate with several of the most popular CRMs.",
          category: "technical"
        },
        {
          question: "Do you provide reporting?",
          answer: "Yes, we provide monthly reports so you can view our analytics month by month to see how good of a job we're doing.",
          category: "technical"
        },
        {
          question: "Do you collect reviews?",
          answer: "Yes, we collect reviews automatically after the customer was taken care of.",
          category: "technical"
        },
        
        // REAL FAQ ANSWERS from website screenshots
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
          question: "What type of support does your team offer?",
          answer: "Nexella provides comprehensive support to assist you every step of the way. Our dedicated support team is available to address any questions, concerns, or technical issues you may encounter. You can reach out to us via email at info@nexella.io, through our online chat feature inside the platform and for certain plans via a dedicated slack support channel.",
          category: "support"
        },
        {
          question: "Can I cancel my subscription anytime?",
          answer: "Yes, if for any reason you decide Nexella AI is not for you. You are welcome to cancel inside of your account or contact our team.",
          category: "billing"
        },
        {
          question: "Can I integrate Nexella with other tools or platforms?",
          answer: "Yes, Nexella offers flexible integration options to seamlessly connect with your existing tools and platforms. Whether it's CRM software, helpdesk systems, or other communication channels, you can integrate Nexella to enhance workflow efficiency and maximize productivity.",
          category: "technical"
        },
        {
          question: "Can I make outbound and inbound calls with Nexella AI?",
          answer: "Yes. Nexella supports both inbound and outbound call capabilities in all plans.",
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
        },
        {
          question: "Can I use Nexella AI for Sales Calls?",
          answer: "Yes, absolutely! Nexella is designed to enhance sales calls by providing AI-powered agents that can engage with customers, answer questions, and assist in closing deals effectively.",
          category: "use_cases"
        },
        {
          question: "Can I use Nexella AI for Customer Support?",
          answer: "Certainly! Nexella is ideal for customer support, allowing you to automate responses, handle inquiries, and provide assistance to customers in a timely and efficient manner.",
          category: "use_cases"
        }
      ];
      
      const REAL_NEXELLA_PRODUCTS = [
        {
          id: "sms-revive",
          name: "SMS Revive",
          description: "SMS system that texts your dead leads and revives them, resulting in booked appointments from low interest customers.",
          features: ["Dead lead revival", "SMS automation", "Appointment booking from cold leads"],
          pricing: "Contact for pricing",
          targetMarket: "Businesses with accumulated dead leads",
          category: "sms_automation"
        },
        {
          id: "ai-voice-calls",
          name: "AI Voice Calls",
          description: "Human-like AI that calls your customers, logs every detail, and schedules appointments for you.",
          features: ["Human-like conversations", "Detail logging", "Automatic appointment scheduling", "Follow-up calls"],
          pricing: "Available in Pro and Performance Based plans",
          targetMarket: "Sales teams and appointment-based businesses",
          category: "voice_automation"
        },
        {
          id: "ai-texting",
          name: "AI Texting",
          description: "Texting App that integrates directly with your website so customers can receive immediate info and book from a human-like agent.",
          features: ["Website integration", "Immediate response", "Human-like texting", "Appointment booking"],
          pricing: "Included in all plans",
          targetMarket: "Businesses with website traffic",
          category: "text_automation"
        },
        {
          id: "appointment-booking",
          name: "Appointment Booking System",
          description: "AI Systems that book your appointments hands-free.",
          features: ["Hands-free booking", "Calendar integration", "Automated scheduling"],
          pricing: "Included in all plans",
          targetMarket: "Service-based businesses",
          category: "scheduling"
        },
        {
          id: "sms-follow-ups",
          name: "SMS Follow-Ups",
          description: "SMS Flows that follow-up on leads making sure they don't lose interest and close.",
          features: ["Automated follow-up sequences", "Interest maintenance", "Closing assistance"],
          pricing: "Available in Pro and Performance Based plans",
          targetMarket: "Sales teams",
          category: "follow_up"
        }
      ];
      
      const REAL_COMPANY_CONTEXT = `
        Nexella AI Company Information (REAL):
        
        Mission: To help businesses stop bleeding sales by automating lead response, customer follow-ups, and support.
        
        Value Proposition: "Book 30% More In 30 Days Or Your Money Back" - guaranteed results or it's free.
        
        Website: nexella.io
        Support Email: info@nexella.io
        
        Core Problem We Solve:
        - The average business loses 50% of leads due to slow response times
        - Every minute you delay responding to a lead, your competition wins
        - Appointment no-shows and weak follow-ups drain calendar and cash flow
        - Overwhelmed support teams cause refund requests, bad reviews, and lost trust
        
        Our Solution:
        - AI-driven Revenue Rescue System
        - Automate lead response, customer follow-ups, and support
        - Deliver measurable results within 30 days
        
        Proven Results:
        - Took Retroshot from $10k/mo to over $200k/mo in 6 months
        - Took Nebula Orb from $25k/mo to over $250k/mo in 8 months
        
        Service Categories:
        1. SMS Systems (SMS Revive, SMS Follow-Ups)
        2. AI Voice Systems (AI Voice Calls, AI Voice Call Follow-UPS)
        3. AI Texting and Chat
        4. Appointment Booking
        5. CRM Integration
        6. Monthly Reporting
        7. Review Collection
        
        Plans:
        - Basic: SMS Revive, AI Chatbot, Appointment Booking, CRM Integration, Monthly reports
        - Pro (Popular): Everything in Basic + AI Voice Call, AI Voice Call Follow Ups, SMS Follow Ups, Pre Qualification Flows
        - Performance Based: Everything in Pro + additional features
        
        Technical Infrastructure:
        - Platform, Voice, LLM, Transcription and Telephony systems included
        - No need for external Twilio or API setup
        - Supports caller ID import for free
        - Flexible integration with CRMs and other platforms
        
        Target Market:
        - Businesses losing leads due to slow response times
        - Companies with dead lead databases
        - Service-based businesses needing appointment scheduling
        - Sales teams wanting to automate follow-ups
        - Businesses overwhelmed with support requests
      `;
      
      // Ingest real knowledge
      const faqResult = await ingestionService.ingestFAQs(REAL_NEXELLA_FAQS);
      const productResult = await ingestionService.ingestProductInfo(REAL_NEXELLA_PRODUCTS);
      
      // Store real company context
      await ingestionService.memoryService.storeMemories([{
        id: 'nexella_real_company_context',
        values: await ingestionService.memoryService.createEmbedding(REAL_COMPANY_CONTEXT),
        metadata: {
          memory_type: 'company_context',
          source: 'nexella_website_real',
          content: REAL_COMPANY_CONTEXT,
          ingestedAt: new Date().toISOString()
        }
      }]);
      
      res.json({
        success: true,
        message: 'REAL Nexella.io knowledge base ingested successfully',
        results: {
          faqs: faqResult,
          products: productResult,
          companyContext: 'stored'
        },
        summary: {
          faqsCount: REAL_NEXELLA_FAQS.length,
          productsCount: REAL_NEXELLA_PRODUCTS.length,
          source: 'real_website_data'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Other ingestion endpoints...
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

// Admin endpoint to toggle memory system
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

// =======================================
// STRICT WEBSOCKET CONNECTION HANDLER
// =======================================

wss.on('connection', async (ws, req) => {
  try {
    console.log('🔗 NEW WEBSOCKET CONNECTION ATTEMPT');
    
    // STRICT CUSTOMER DATA VALIDATION - NO FALLBACKS
    const customerValidation = validateCustomerData(req);
    
    if (!customerValidation.isValid) {
      console.error('❌ CONNECTION REJECTED: No valid customer data found');
      console.error('📧 Required: Real customer email (not test/demo/example)');
      console.error('🚫 Closing connection immediately');
      
      // Send rejection message before closing
      ws.send(JSON.stringify({
        error: 'CUSTOMER_DATA_REQUIRED',
        message: 'Valid customer data required for connection',
        code: 1008
      }));
      
      // Close connection with policy violation code
      ws.close(1008, 'Customer data validation failed');
      return;
    }
    
    console.log(`✅ CUSTOMER DATA VALIDATED: ${customerValidation.email} (source: ${customerValidation.source})`);
    
    // Additional validation: Check if this is a real business email
    const email = customerValidation.email;
    const domain = email.split('@')[1];
    
    // Log for analytics but don't reject (some real customers use gmail/yahoo)
    if (['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'].includes(domain)) {
      console.log(`📝 Note: Personal email domain detected: ${domain} (allowed but logged)`);
    }
    
    // Decide which handler to use based on memory system settings
    const useMemory = shouldUseMemoryHandler(req);
    
    if (useMemory) {
      console.log('🧠 Initializing MEMORY-ENHANCED WebSocket handler');
      console.log('📚 AI will have access to company knowledge and customer history');
      new WebSocketHandlerWithMemory(ws, req);
    } else {
      console.log('📞 Initializing REGULAR WebSocket handler');
      console.log('💬 AI will use standard conversation flow');
      new WebSocketHandler(ws, req);
    }
    
    // Log successful connection for analytics
    console.log(`📊 SUCCESSFUL CONNECTION - Email: ${email}, Source: ${customerValidation.source}, Memory: ${useMemory ? 'YES' : 'NO'}`);
    
  } catch (error) {
    console.error('❌ CRITICAL ERROR in WebSocket connection:', error.message);
    console.error('📍 Stack trace:', error.stack);
    
    // Always close connection on any error - no fallbacks
    try {
      ws.send(JSON.stringify({
        error: 'CONNECTION_ERROR',
        message: 'Unable to establish connection',
        code: 1011
      }));
    } catch (sendError) {
      console.error('❌ Could not send error message to client:', sendError.message);
    }
    
    ws.close(1011, 'Internal server error');
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
  const protocol = isProduction ? 'https:' : 'http:';
  const wsProtocol = isProduction ? 'wss:' : 'ws:';
  
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
  
  // STRICT CUSTOMER DATA VALIDATION STATUS
  console.log('🔒 STRICT CUSTOMER DATA VALIDATION: ENFORCED ✅');
  console.log('🚫 Fake/demo/test emails will be REJECTED');
  console.log('📧 Required: Real customer emails only');
  console.log('📝 Accepted sources:');
  console.log('   ✓ Typeform submissions');
  console.log('   ✓ URL parameters (?customer_email=...)');
  console.log('   ✓ Webhook metadata');
  console.log('   ✓ Trigger server endpoints');
  
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
    console.log('🏢 Real Nexella.io knowledge available:');
    console.log('   ✓ Company FAQ and services');
    console.log('   ✓ Product information');
    console.log('   ✓ Success stories');
    console.log('   ✓ Technical capabilities');
    console.log(`🔗 Admin endpoints:`);
    console.log(`   📤 Ingest knowledge: ${isProduction ? host : 'http://localhost:' + PORT}/admin/ingest/nexella-knowledge`);
    console.log(`   🔍 Search knowledge: ${isProduction ? host : 'http://localhost:' + PORT}/admin/search/knowledge?q=pricing`);
    console.log(`   📊 View stats: ${isProduction ? host : 'http://localhost:' + PORT}/admin/stats/ingestion`);
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
  console.log(`   🔒 Customer Validation: STRICT`);
  console.log(`   🧠 Memory System: ${config.ENABLE_MEMORY && WebSocketHandlerWithMemory ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   📚 Knowledge System: ${ingestionService ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   📅 Calendar Integration: ${calendarInitialized ? 'CONNECTED' : 'DISABLED'}`);
  console.log(`   🌐 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log('');
  
  if (isProduction) {
    console.log('🚀 PRODUCTION READY - Server accessible worldwide!');
    
    // Show key URLs for production
    console.log('🔗 Key URLs:');
    console.log(`   📊 Health Check: ${host}/health`);
    console.log(`   🧠 Memory Health: ${host}/health/memory`);
    console.log(`   📚 Ingest Knowledge: ${host}/admin/ingest/nexella-knowledge`);
    
    console.log('✅ All systems operational for real customer connections!');
  } else {
    console.log('💻 Development server ready for testing');
    console.log('💡 Use real customer emails to test connections');
  }
});
