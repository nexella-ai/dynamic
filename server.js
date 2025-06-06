// server.js - Main Server Entry Point (Modular Version)
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

// Configuration and Services
const config = require('./src/config/environment');
const { initializeCalendarService } = require('./src/services/calendar/CalendarHelpers');

// Routes and Handlers
const apiRoutes = require('./src/routes/apiRoutes');
const WebSocketHandler = require('./src/handlers/WebSocketHandler');

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

// Initialize services
let calendarInitialized = false;

(async () => {
  try {
    console.log('🚀 Initializing Nexella WebSocket Server...');
    
    // Initialize Google Calendar service
    calendarInitialized = await initializeCalendarService();
    
    if (calendarInitialized) {
      console.log('✅ Google Calendar service ready');
    } else {
      console.log('⚠️ Google Calendar service disabled - using demo mode');
      console.log('💡 Add Google Calendar environment variables for real scheduling');
    }
    
    console.log('✅ Server initialization complete');
    
  } catch (error) {
    console.error('❌ Server initialization error:', error.message);
    console.log('⚠️ Some features may be limited');
  }
})();

// API Routes
app.use('/', apiRoutes);

// WebSocket Connection Handler
wss.on('connection', async (ws, req) => {
  try {
    // Create new WebSocket handler instance for each connection
    new WebSocketHandler(ws, req);
  } catch (error) {
    console.error('❌ Error creating WebSocket handler:', error.message);
    ws.close();
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

// Start server
const PORT = config.PORT;
server.listen(PORT, () => {
  const status = calendarInitialized ? 'Real Google Calendar' : 'Demo Mode';
  console.log(`✅ Nexella WebSocket Server listening on port ${PORT}`);
  console.log(`📅 Calendar Status: ${status}`);
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`🔗 WebSocket URL: ws://localhost:${PORT}`);
  
  if (!validation.hasGoogleCalendar) {
    console.log('💡 To enable real Google Calendar:');
    console.log('   1. Add GOOGLE_PROJECT_ID to environment');
    console.log('   2. Add GOOGLE_PRIVATE_KEY to environment');
    console.log('   3. Add GOOGLE_CLIENT_EMAIL to environment');
    console.log('   4. Add GOOGLE_CALENDAR_ID to environment');
  }
});