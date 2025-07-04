// src/routes/apiRoutes.js - COMPLETE FILE WITH ALL ENDPOINTS INCLUDING TYPEFORM
const express = require('express');
const axios = require('axios');
const config = require('../config/environment');
const { storeContactInfoGlobally } = require('../services/webhooks/WebhookService');
const { isCalendarInitialized, autoBookAppointment, getAvailableTimeSlots } = require('../services/calendar/CalendarHelpers');

// Import booking memory service
let AppointmentBookingMemory = null;
try {
  AppointmentBookingMemory = require('../services/memory/AppointmentBookingMemory');
} catch (error) {
  console.log('⚠️ AppointmentBookingMemory not available');
}

// Import WebSocketHandlerWithMemory for health check
const WebSocketHandlerWithMemory = require('../handlers/WebSocketHandlerWithMemory');
console.log('✅ WebSocketHandlerWithMemory available for health checks');

// Import memory services
let RAGMemoryService = null;
let DocumentIngestionService = null;
try {
  RAGMemoryService = require('../services/memory/RAGMemoryService');
  DocumentIngestionService = require('../services/memory/DocumentIngestionService');
} catch (error) {
  console.log('⚠️ Memory services not available');
}

// Import Typeform handler
let TypeformWebhookHandler = null;
try {
  TypeformWebhookHandler = require('../services/webhooks/TypeformWebhookHandler');
} catch (error) {
  console.log('⚠️ TypeformWebhookHandler not available');
}

const router = express.Router();
const typeformHandler = TypeformWebhookHandler ? new TypeformWebhookHandler() : null;

// Root endpoint
router.get('/', (req, res) => {
  const status = isCalendarInitialized() ? 'Real Calendar ✅' : 'Demo Mode (add environment variables for real calendar) ⚠️';
  res.send(`Nexella WebSocket Server is live! Calendar Status: ${status}`);
});

// Enhanced health check endpoint with calendar status
router.get('/health', (req, res) => {
  const validation = config.validate();
  const calendarStatus = isCalendarInitialized();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: {
      hasOpenAI: !!config.OPENAI_API_KEY,
      hasRetell: !!config.RETELL_API_KEY,
      hasGoogleCalendar: validation.hasGoogleCalendar,
      calendarMode: calendarStatus ? 'real_calendar' : 'demo_mode',
      calendarInitialized: calendarStatus
    },
    validation: validation,
    calendarDetails: {
      initialized: calendarStatus,
      projectId: config.GOOGLE_PROJECT_ID ? 'SET' : 'MISSING',
      serviceAccount: config.GOOGLE_CLIENT_EMAIL ? 'SET' : 'MISSING',
      privateKey: config.GOOGLE_PRIVATE_KEY ? 'SET' : 'MISSING',
      calendarId: config.GOOGLE_CALENDAR_ID
    }
  });
});

// Calendar debug endpoint
router.get('/debug/calendar', async (req, res) => {
  try {
    console.log('🔍 DEBUGGING CALENDAR SETUP');
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: {
        GOOGLE_PROJECT_ID: config.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING',
        GOOGLE_PRIVATE_KEY: config.GOOGLE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING',
        GOOGLE_CLIENT_EMAIL: config.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING',
        GOOGLE_CALENDAR_ID: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
        GOOGLE_IMPERSONATE_EMAIL: config.GOOGLE_IMPERSONATE_EMAIL || 'jaden@nexellaai.com'
      },
      calendar: {
        initialized: isCalendarInitialized(),
        status: isCalendarInitialized() ? 'READY ✅' : 'NOT READY ❌'
      },
      tests: {}
    };

    // Test calendar initialization
    try {
      const { initializeCalendarService } = require('../services/calendar/CalendarHelpers');
      const initResult = await initializeCalendarService();
      debugInfo.tests.initialization = {
        success: initResult,
        message: initResult ? 'Calendar service initialized successfully' : 'Calendar initialization failed'
      };
    } catch (error) {
      debugInfo.tests.initialization = {
        success: false,
        error: error.message
      };
    }

    // Test getting available slots
    if (isCalendarInitialized()) {
      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const slots = await getAvailableTimeSlots(tomorrow);
        debugInfo.tests.availableSlots = {
          success: true,
          date: tomorrow.toDateString(),
          slotsFound: slots.length,
          sampleSlots: slots.slice(0, 3).map(slot => ({
            time: slot.displayTime,
            startTime: slot.startTime
          }))
        };
      } catch (error) {
        debugInfo.tests.availableSlots = {
          success: false,
          error: error.message
        };
      }
    }

    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Calendar debug failed'
    });
  }
});

// Debug calendar access endpoint
router.get('/debug/calendar-access', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const { getCalendarService } = require('../services/calendar/CalendarHelpers');
    
    const calendarService = getCalendarService();
    if (!calendarService || !calendarService.auth) {
      return res.status(500).json({ error: 'Calendar service not initialized' });
    }
    
    const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
    
    const results = {
      serviceAccount: calendarService.auth.email || config.GOOGLE_CLIENT_EMAIL,
      impersonatedUser: calendarService.auth.subject || 'none',
      targetCalendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
      tests: {}
    };
    
    // Test 1: List all calendars
    try {
      const calendarList = await calendar.calendarList.list({
        maxResults: 10,
        showHidden: true
      });
      
      results.tests.listCalendars = {
        success: true,
        count: calendarList.data.items?.length || 0,
        calendars: calendarList.data.items?.map(cal => ({
          id: cal.id,
          summary: cal.summary,
          primary: cal.primary,
          accessRole: cal.accessRole
        }))
      };
    } catch (error) {
      results.tests.listCalendars = {
        success: false,
        error: error.message
      };
    }
    
    // Test 2: Access primary calendar
    try {
      const primaryCalendar = await calendar.calendars.get({
        calendarId: 'primary'
      });
      
      results.tests.primaryCalendar = {
        success: true,
        id: primaryCalendar.data.id,
        summary: primaryCalendar.data.summary,
        timeZone: primaryCalendar.data.timeZone
      };
    } catch (error) {
      results.tests.primaryCalendar = {
        success: false,
        error: error.message
      };
    }
    
    // Test 3: Try to access the specific calendar
    try {
      const specificCalendar = await calendar.calendars.get({
        calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com'
      });
      
      results.tests.specificCalendar = {
        success: true,
        id: specificCalendar.data.id,
        summary: specificCalendar.data.summary,
        timeZone: specificCalendar.data.timeZone,
        description: specificCalendar.data.description
      };
    } catch (error) {
      results.tests.specificCalendar = {
        success: false,
        error: error.message,
        hint: 'Make sure calendar is shared with: ' + (calendarService.auth.email || config.GOOGLE_CLIENT_EMAIL)
      };
    }
    
    // Test 4: List events from specific calendar
    try {
      const events = await calendar.events.list({
        calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
        maxResults: 5,
        timeMin: new Date().toISOString()
      });
      
      results.tests.listEvents = {
        success: true,
        count: events.data.items?.length || 0
      };
    } catch (error) {
      results.tests.listEvents = {
        success: false,
        error: error.message
      };
    }
    
    res.json(results);
    
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// Debug endpoint to list calendar events
router.get('/debug/list-events', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const { getCalendarService, isCalendarInitialized } = require('../services/calendar/CalendarHelpers');
    
    if (!isCalendarInitialized()) {
      return res.status(500).json({ error: 'Calendar not initialized' });
    }
    
    const calendarService = getCalendarService();
    const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
    
    // Get date range (default to +/- 7 days from now)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30); // Look 30 days ahead
    
    console.log('🔍 Listing events from:', startDate.toISOString());
    console.log('🔍 To:', endDate.toISOString());
    
    try {
      // List events from the calendar
      const response = await calendar.events.list({
        calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime'
      });
      
      const events = response.data.items || [];
      
      console.log(`📅 Found ${events.length} events`);
      
      const formattedEvents = events.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        startArizona: event.start?.dateTime ? 
          new Date(event.start.dateTime).toLocaleString('en-US', { timeZone: 'America/Phoenix' }) : 
          event.start?.date,
        created: event.created,
        creator: event.creator?.email,
        status: event.status,
        htmlLink: event.htmlLink
      }));
      
      res.json({
        success: true,
        calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
        totalEvents: events.length,
        dateRange: {
          from: startDate.toISOString(),
          to: endDate.toISOString()
        },
        events: formattedEvents,
        // Look specifically for the test event
        testEventFound: events.some(e => e.summary === 'Nexella AI Consultation Call')
      });
      
    } catch (listError) {
      console.error('❌ Error listing events:', listError);
      res.status(500).json({
        success: false,
        error: listError.message,
        details: listError.response?.data
      });
    }
    
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug endpoint to get a specific event by ID
router.get('/debug/get-event/:eventId', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const { getCalendarService, isCalendarInitialized } = require('../services/calendar/CalendarHelpers');
    
    if (!isCalendarInitialized()) {
      return res.status(500).json({ error: 'Calendar not initialized' });
    }
    
    const calendarService = getCalendarService();
    const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
    
    const eventId = req.params.eventId;
    console.log('🔍 Looking for event:', eventId);
    
    try {
      const response = await calendar.events.get({
        calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
        eventId: eventId
      });
      
      const event = response.data;
      
      res.json({
        success: true,
        found: true,
        event: {
          id: event.id,
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
          created: event.created,
          updated: event.updated,
          creator: event.creator,
          organizer: event.organizer,
          status: event.status,
          htmlLink: event.htmlLink,
          startArizona: event.start?.dateTime ? 
            new Date(event.start.dateTime).toLocaleString('en-US', { timeZone: 'America/Phoenix' }) : 
            'N/A'
        }
      });
      
    } catch (getError) {
      if (getError.response?.status === 404) {
        res.json({
          success: true,
          found: false,
          message: 'Event not found in calendar'
        });
      } else {
        res.status(500).json({
          success: false,
          error: getError.message,
          details: getError.response?.data
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug endpoint to test calendar access
router.get('/debug/test-calendar-access', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const { getCalendarService, isCalendarInitialized } = require('../services/calendar/CalendarHelpers');
    
    if (!isCalendarInitialized()) {
      return res.status(500).json({ error: 'Calendar not initialized' });
    }
    
    const calendarService = getCalendarService();
    const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
    
    // Get the auth client details
    const authClient = calendarService.auth;
    
    const results = {
      serviceAccountEmail: authClient.email || config.GOOGLE_CLIENT_EMAIL,
      targetCalendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
      tests: {}
    };
    
    // Test 1: List all calendars
    try {
      const calendarList = await calendar.calendarList.list({
        maxResults: 50,
        showHidden: true
      });
      
      results.tests.calendarList = {
        success: true,
        totalCalendars: calendarList.data.items?.length || 0,
        calendars: calendarList.data.items?.map(cal => ({
          id: cal.id,
          summary: cal.summary,
          accessRole: cal.accessRole,
          primary: cal.primary,
          isTargetCalendar: cal.id === results.targetCalendarId
        })) || []
      };
      
      // Check if target calendar is accessible
      const targetCalendarFound = calendarList.data.items?.some(cal => cal.id === results.targetCalendarId);
      results.tests.targetCalendarAccessible = targetCalendarFound;
      
      if (!targetCalendarFound) {
        results.solution = `Calendar ${results.targetCalendarId} is NOT accessible by service account ${results.serviceAccountEmail}. Please share the calendar with this email address with "Make changes to events" permission.`;
      }
      
    } catch (error) {
      results.tests.calendarList = {
        success: false,
        error: error.message
      };
    }
    
    // Test 2: Try to access the target calendar directly
    try {
      const cal = await calendar.calendars.get({
        calendarId: results.targetCalendarId
      });
      
      results.tests.directCalendarAccess = {
        success: true,
        calendarSummary: cal.data.summary,
        timeZone: cal.data.timeZone
      };
    } catch (error) {
      results.tests.directCalendarAccess = {
        success: false,
        error: error.message,
        hint: 'Calendar not accessible - needs to be shared with service account'
      };
    }
    
    // Test 3: Try to create a test event
    if (req.query.createTest === 'true' && results.tests.targetCalendarAccessible) {
      try {
        const testEvent = {
          summary: 'TEST EVENT - DELETE ME',
          description: 'This is a test event created to verify calendar access',
          start: {
            dateTime: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
            timeZone: 'America/Phoenix'
          },
          end: {
            dateTime: new Date(Date.now() + 90000000).toISOString(), // Tomorrow + 1 hour
            timeZone: 'America/Phoenix'
          }
        };
        
        const created = await calendar.events.insert({
          calendarId: results.targetCalendarId,
          resource: testEvent
        });
        
        results.tests.createEvent = {
          success: true,
          eventId: created.data.id,
          htmlLink: created.data.htmlLink,
          message: 'Test event created successfully - check your calendar!'
        };
        
        // Try to delete it immediately
        try {
          await calendar.events.delete({
            calendarId: results.targetCalendarId,
            eventId: created.data.id
          });
          results.tests.createEvent.deleted = true;
        } catch (delError) {
          results.tests.createEvent.deleted = false;
          results.tests.createEvent.deleteError = delError.message;
        }
        
      } catch (error) {
        results.tests.createEvent = {
          success: false,
          error: error.message
        };
      }
    }
    
    res.json(results);
    
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// COMPREHENSIVE Calendar test endpoint
router.get('/test-calendar-booking', async (req, res) => {
  try {
    console.log('🧪 COMPREHENSIVE CALENDAR BOOKING TEST');
    
    const results = {
      timestamp: new Date().toISOString(),
      environment: {},
      authentication: {},
      connection: {},
      availability: {},
      booking: {}
    };
    
    // 1. Check environment variables
    results.environment = {
      GOOGLE_PROJECT_ID: config.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING',
      GOOGLE_PRIVATE_KEY: config.GOOGLE_PRIVATE_KEY ? `✅ SET (${config.GOOGLE_PRIVATE_KEY.length} chars)` : '❌ MISSING',
      GOOGLE_CLIENT_EMAIL: config.GOOGLE_CLIENT_EMAIL ? `✅ SET (${config.GOOGLE_CLIENT_EMAIL})` : '❌ MISSING',
      GOOGLE_CALENDAR_ID: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
      GOOGLE_IMPERSONATE_EMAIL: config.GOOGLE_IMPERSONATE_EMAIL || 'jaden@nexellaai.com',
      privateKeyValid: config.GOOGLE_PRIVATE_KEY?.includes('-----BEGIN PRIVATE KEY-----') ? '✅ Valid format' : '❌ Invalid format'
    };
    
    // 2. Test authentication
    try {
      const { initializeCalendarService, getCalendarService } = require('../services/calendar/CalendarHelpers');
      const initialized = await initializeCalendarService();
      results.authentication.initialized = initialized;
      results.authentication.status = initialized ? '✅ SUCCESS' : '❌ FAILED';
      
      const calendarService = getCalendarService();
      if (calendarService) {
        results.authentication.serviceInfo = calendarService.getCalendarInfo();
      }
    } catch (authError) {
      results.authentication.error = authError.message;
      results.authentication.status = '❌ FAILED';
    }
    
    // 3. Test calendar connection
    if (results.authentication.initialized) {
      try {
        const { getCalendarService } = require('../services/calendar/CalendarHelpers');
        const calendarService = getCalendarService();
        
        // Test listing calendars
        const { google } = require('googleapis');
        const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
        
        const calendarList = await calendar.calendarList.list({ maxResults: 10 });
        results.connection.calendarAccess = '✅ Can access Calendar API';
        results.connection.calendarsFound = calendarList.data.items?.length || 0;
        
        // Test specific calendar access
        try {
          const calendarInfo = await calendar.calendars.get({
            calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com'
          });
          results.connection.targetCalendar = {
            id: calendarInfo.data.id,
            summary: calendarInfo.data.summary,
            timeZone: calendarInfo.data.timeZone,
            access: '✅ Can access target calendar'
          };
        } catch (calError) {
          results.connection.targetCalendar = {
            error: calError.message,
            access: '❌ Cannot access target calendar',
            hint: `Share calendar with: ${config.GOOGLE_CLIENT_EMAIL}`
          };
        }
        
        // Test event creation permission
        try {
          const testList = await calendar.events.list({
            calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
            maxResults: 1
          });
          results.connection.eventPermissions = '✅ Can read events';
        } catch (permError) {
          results.connection.eventPermissions = '❌ Cannot read events';
        }
        
      } catch (connError) {
        results.connection.error = connError.message;
        results.connection.status = '❌ Connection failed';
      }
    }
    
    // 4. Test getting available slots
    if (results.authentication.initialized) {
      try {
        const { getAvailableTimeSlots } = require('../services/calendar/CalendarHelpers');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const slots = await getAvailableTimeSlots(tomorrow);
        results.availability = {
          date: tomorrow.toDateString(),
          slotsFound: slots.length,
          slots: slots.slice(0, 3).map(s => ({
            time: s.displayTime,
            start: s.startTime,
            end: s.endTime
          })),
          status: slots.length > 0 ? '✅ Slots available' : '⚠️ No slots available'
        };
      } catch (slotError) {
        results.availability.error = slotError.message;
        results.availability.status = '❌ Failed to get slots';
      }
    }
    
    // 5. Test actual booking (UPDATED WITH TIMEZONE FIX)
    if (results.authentication.initialized && req.query.testBooking === 'true') {
      try {
        const { autoBookAppointment } = require('../services/calendar/CalendarHelpers');
        
        // Book for tomorrow at 10 AM ARIZONA TIME (not UTC)
        const bookingDate = new Date();
        bookingDate.setDate(bookingDate.getDate() + 1);
        
        // Set to 10 AM in the server's local time, then adjust for Arizona
        bookingDate.setHours(10, 0, 0, 0);
        
        // If your server is in UTC, you need to add 7 hours to get 10 AM Arizona time
        // Arizona is UTC-7 (no daylight saving)
        // So 10 AM Arizona = 5 PM UTC (17:00 UTC)
        const arizonaOffset = 7; // hours
        bookingDate.setHours(10 + arizonaOffset, 0, 0, 0);
        
        console.log('📅 Test booking time (UTC):', bookingDate.toISOString());
        console.log('📅 Test booking time (Arizona):', bookingDate.toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
        
        const bookingResult = await autoBookAppointment(
          'John Smith',  // More realistic name
          'john.smith@example.com',  // More realistic email
          '+14805551234',  // Arizona phone number
          bookingDate,
          { 
            source: 'Website contact form',
            businessType: 'Solar Installation Company',
            notes: 'Interested in AI appointment scheduling'
          }
        );
        
        results.booking = bookingResult;
        
        if (bookingResult.success) {
          results.booking.status = '✅ BOOKING SUCCESSFUL!';
          results.booking.arizonaTime = bookingDate.toLocaleString('en-US', { 
            timeZone: 'America/Phoenix',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          console.log('🎉 TEST BOOKING CREATED:', bookingResult.eventId);
          console.log('📅 Booked for:', results.booking.arizonaTime);
          
          // Try to delete the test event
          try {
            const { getCalendarService } = require('../services/calendar/CalendarHelpers');
            const calendarService = getCalendarService();
            const { google } = require('googleapis');
            const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
            
            await calendar.events.delete({
              calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
              eventId: bookingResult.eventId
            });
            results.booking.cleanup = '✅ Test event deleted';
          } catch (deleteError) {
            results.booking.cleanup = '⚠️ Could not delete test event - please delete manually';
          }
        }
      } catch (bookingError) {
        results.booking.error = bookingError.message;
        results.booking.status = '❌ Booking failed';
        results.booking.stack = bookingError.stack;
      }
    } else if (!req.query.testBooking) {
      results.booking.status = 'ℹ️ Add ?testBooking=true to test actual booking';
    }
    
    // Summary
    results.summary = {
      ready: !!(results.authentication.initialized && 
               results.connection.targetCalendar?.access?.includes('✅') &&
               results.availability.slotsFound > 0),
      issues: []
    };
    
    if (!results.environment.GOOGLE_PROJECT_ID.includes('✅')) {
      results.summary.issues.push('Missing GOOGLE_PROJECT_ID');
    }
    if (!results.environment.GOOGLE_PRIVATE_KEY.includes('✅')) {
      results.summary.issues.push('Missing GOOGLE_PRIVATE_KEY');
    }
    if (!results.environment.GOOGLE_CLIENT_EMAIL.includes('✅')) {
      results.summary.issues.push('Missing GOOGLE_CLIENT_EMAIL');
    }
    if (!results.environment.privateKeyValid?.includes('✅')) {
      results.summary.issues.push('Invalid private key format');
    }
    if (!results.authentication.initialized) {
      results.summary.issues.push('Calendar service not initialized');
    }
    if (results.connection.targetCalendar?.access?.includes('❌')) {
      results.summary.issues.push(`Calendar not accessible - share with: ${config.GOOGLE_CLIENT_EMAIL}`);
    }
    
    res.json(results);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Test booking endpoint
router.post('/test-booking', express.json(), async (req, res) => {
  try {
    console.log('🧪 Testing calendar booking...');
    
    const { name, email, phone, datetime } = req.body;
    
    // Validate input
    if (!name || !email || !datetime) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, email, datetime',
        required: ['name', 'email', 'datetime'],
        received: { name: !!name, email: !!email, datetime: !!datetime }
      });
    }
    
    // Check calendar status
    if (!isCalendarInitialized()) {
      return res.status(500).json({
        success: false,
        error: 'Google Calendar not initialized',
        hint: 'Check environment variables and calendar setup',
        calendarStatus: 'NOT_INITIALIZED'
      });
    }
    
    const bookingDate = new Date(datetime);
    const discoveryData = {
      test: 'This is a test booking from API endpoint',
      source: 'API test endpoint',
      timestamp: new Date().toISOString()
    };
    
    console.log('📅 Attempting test booking:', {
      name,
      email,
      phone,
      datetime: bookingDate.toISOString()
    });
    
    const result = await autoBookAppointment(name, email, phone, bookingDate, discoveryData);
    
    if (result.success) {
      console.log('✅ Test booking successful!');
      
      // Also test the webhook
      const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');
      
      const webhookResult = await sendSchedulingPreference(
        name,
        email,
        phone,
        `Test appointment at ${bookingDate.toLocaleString()}`,
        'test_call_' + Date.now(),
        {
          ...discoveryData,
          appointment_booked: true,
          booking_confirmed: true,
          meeting_link: result.meetingLink,
          event_id: result.eventId,
          event_link: result.eventLink,
          test_booking: true
        }
      );
      
      res.json({
        success: true,
        message: 'Test booking completed successfully',
        calendar: {
          eventId: result.eventId,
          meetingLink: result.meetingLink,
          eventLink: result.eventLink,
          displayTime: result.displayTime,
          timezone: result.timezone || 'America/Phoenix',
          manualInvitationRequired: result.manualInvitationRequired
        },
        webhook: {
          sent: webhookResult.success,
          error: webhookResult.error || null
        },
        bookingDetails: {
          customerName: name,
          customerEmail: email,
          requestedTime: bookingDate.toISOString(),
          confirmedTime: result.startTime
        }
      });
      
    } else {
      console.log('❌ Test booking failed:', result.error);
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message || 'Booking failed',
        calendarStatus: 'BOOKING_FAILED'
      });
    }
    
  } catch (error) {
    console.error('❌ Test booking error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Set customer data endpoint - for N8N to send Typeform data
router.post('/set-customer-data', express.json(), async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    
    console.log('📋 Received customer data from N8N:', { name, email, phone });
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    // Store globally for the next call
    storeContactInfoGlobally(name, email, phone, 'N8N Typeform');
    
    console.log('✅ Customer data stored successfully for next call');
    res.status(200).json({ 
      success: true, 
      message: 'Customer data stored successfully',
      data: { name, email, phone }
    });
    
  } catch (error) {
    console.error('❌ Error storing customer data:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Typeform webhook endpoint
router.post('/webhook/typeform', express.json(), async (req, res) => {
  try {
    console.log('📋 Received Typeform webhook');
    console.log('Event type:', req.body.event_type);
    
    if (!typeformHandler) {
      return res.status(503).json({
        success: false,
        error: 'Typeform handler not available'
      });
    }
    
    // Process the webhook
    const result = await typeformHandler.processTypeformWebhook(req.body);
    
    if (result.success) {
      console.log('✅ Typeform data processed:', result.customerData);
      
      // Optional: Trigger an outbound call immediately
      if (result.customerData.phone && req.query.trigger_call === 'true') {
        // You can add logic here to trigger a call via Retell API
        console.log('📞 Would trigger call to:', result.customerData.phone);
      }
      
      res.status(200).json({
        success: true,
        message: 'Typeform submission processed',
        customer: {
          name: result.customerData.full_name,
          email: result.customerData.email,
          company: result.customerData.company_name,
          pain_point: result.customerData.pain_point
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('❌ Typeform webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug endpoint to see raw Typeform webhook data
router.post('/webhook/typeform/debug', express.json(), async (req, res) => {
  console.log('🔍 DEBUG: Raw Typeform webhook received');
  console.log('🔍 Headers:', req.headers);
  console.log('🔍 Body:', JSON.stringify(req.body, null, 2));
  
  if (req.body.form_response && req.body.form_response.answers) {
    console.log('🔍 Answers array:');
    req.body.form_response.answers.forEach((answer, index) => {
      console.log(`Answer ${index}:`, {
        field_id: answer.field?.id,
        field_ref: answer.field?.ref,
        field_title: answer.field?.title,
        type: answer.type,
        text: answer.text,
        email: answer.email,
        phone_number: answer.phone_number,
        choice: answer.choice
      });
    });
  }
  
  res.json({ 
    success: true, 
    message: 'Debug data logged to console',
    answersCount: req.body.form_response?.answers?.length || 0
  });
});

// Get Typeform data by email (for testing/debugging)
router.get('/typeform/customer/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!typeformHandler || !typeformHandler.memoryService) {
      return res.status(503).json({
        success: false,
        error: 'Memory service not available'
      });
    }
    
    const customerData = await typeformHandler.getCustomerFromMemory(email);
    
    if (customerData) {
      res.json({
        success: true,
        customer: customerData
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual Typeform data submission (for testing)
router.post('/typeform/submit', express.json(), async (req, res) => {
  try {
    const { 
      first_name, 
      last_name, 
      email, 
      phone, 
      company_name, 
      pain_point 
    } = req.body;
    
    // Validate required fields
    if (!email || !first_name || !pain_point) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, first_name, pain_point'
      });
    }
    
    if (!typeformHandler) {
      return res.status(503).json({
        success: false,
        error: 'Typeform handler not available'
      });
    }
    
    // Create mock Typeform webhook data
    const mockWebhookData = {
      event_id: `test_${Date.now()}`,
      event_type: 'form_response',
      form_response: {
        form_id: 'q0upggQW',
        response_id: `test_response_${Date.now()}`,
        submitted_at: new Date().toISOString(),
        answers: [
          {
            field: { id: 'field_1', ref: 'first_name', title: 'First Name' },
            type: 'text',
            text: first_name
          },
          {
            field: { id: 'field_2', ref: 'last_name', title: 'Last Name' },
            type: 'text',
            text: last_name
          },
          {
            field: { id: 'field_3', ref: 'email', title: 'Email' },
            type: 'email',
            email: email
          },
          {
            field: { id: 'field_4', ref: 'phone', title: 'Phone Number' },
            type: 'phone_number',
            phone_number: phone
          },
          {
            field: { id: 'field_5', ref: 'company_name', title: 'Company Name' },
            type: 'text',
            text: company_name
          },
          {
            field: { id: 'field_6', ref: 'pain_point', title: 'What are you struggling the most with?' },
            type: 'choice',
            choice: { label: pain_point }
          }
        ]
      }
    };
    
    // Process through the handler
    const result = await typeformHandler.processTypeformWebhook(mockWebhookData);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test Typeform submission processed',
        customer: result.customerData,
        metadata: result.callMetadata
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Calendar status endpoint
router.get('/calendar-status', (req, res) => {
  const { getCalendarService } = require('../services/calendar/CalendarHelpers');
  const calendarService = getCalendarService();
  
  res.json({
    initialized: isCalendarInitialized(),
    info: calendarService ? calendarService.getCalendarInfo() : null,
    mode: isCalendarInitialized() ? 'real_calendar' : 'demo_mode',
    environmentVariables: {
      projectId: config.GOOGLE_PROJECT_ID ? 'SET' : 'MISSING',
      serviceAccount: config.GOOGLE_CLIENT_EMAIL ? 'SET' : 'MISSING',
      privateKey: config.GOOGLE_PRIVATE_KEY ? `SET (length: ${config.GOOGLE_PRIVATE_KEY.length})` : 'MISSING',
      calendarId: config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
      impersonateEmail: config.GOOGLE_IMPERSONATE_EMAIL || 'jaden@nexellaai.com'
    }
  });
});

// Test endpoint for calendar functionality
router.get('/test-calendar', async (req, res) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const slots = await getAvailableTimeSlots(tomorrow);
    
    res.json({
      success: true,
      date: tomorrow.toDateString(),
      availableSlots: slots,
      mode: isCalendarInitialized() ? 'real_calendar' : 'demo_mode',
      calendarStatus: isCalendarInitialized() ? 'INITIALIZED' : 'NOT_INITIALIZED'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      calendarStatus: isCalendarInitialized() ? 'INITIALIZED_BUT_ERROR' : 'NOT_INITIALIZED'
    });
  }
});

// NEW: Appointment Booking Memory Endpoints
router.post('/admin/ingest/booking-patterns', async (req, res) => {
  try {
    if (!AppointmentBookingMemory) {
      return res.status(500).json({
        success: false,
        error: 'AppointmentBookingMemory service not available'
      });
    }
    
    console.log('📅 Ingesting appointment booking patterns...');
    
    const bookingMemory = new AppointmentBookingMemory();
    await bookingMemory.ingestCommonBookingPhrases();
    
    // Add more specific patterns for your use case
    const additionalPatterns = [
      { phrase: "what about thursday at nine", day: "thursday", time: "9:00 AM" },
      { phrase: "thursday at nine am", day: "thursday", time: "9:00 AM" },
      { phrase: "can we meet thursday at 9", day: "thursday", time: "9:00 AM" },
      { phrase: "thursday morning at nine", day: "thursday", time: "9:00 AM" },
      { phrase: "9am on thursday", day: "thursday", time: "9:00 AM" },
      { phrase: "thursday 9 o'clock", day: "thursday", time: "9:00 AM" },
      { phrase: "is 9am thursday available", day: "thursday", time: "9:00 AM" },
      { phrase: "book thursday at nine", day: "thursday", time: "9:00 AM" },
      { phrase: "how about thursday at 9", day: "thursday", time: "9:00 AM" },
      { phrase: "thursday nine am works", day: "thursday", time: "9:00 AM" },
      { phrase: "lets do thursday at 9", day: "thursday", time: "9:00 AM" },
      { phrase: "thursday morning 9", day: "thursday", time: "9:00 AM" },
      { phrase: "9 oclock thursday", day: "thursday", time: "9:00 AM" },
      { phrase: "thursday at 9 is good", day: "thursday", time: "9:00 AM" },
      { phrase: "thursday at 9 please", day: "thursday", time: "9:00 AM" }
    ];
    
    for (const pattern of additionalPatterns) {
      const content = `Booking phrase: "${pattern.phrase}" means ${pattern.day} at ${pattern.time}`;
      const embedding = await bookingMemory.memoryService.createEmbedding(content);
      
      await bookingMemory.memoryService.storeMemories([{
        id: `custom_booking_${pattern.phrase.replace(/\s+/g, '_')}`,
        values: embedding,
        metadata: {
          memory_type: 'booking_phrase',
          phrase: pattern.phrase,
          day: pattern.day,
          time: pattern.time,
          source: 'custom_patterns'
        }
      }]);
    }
    
    res.json({
      success: true,
      message: 'Booking patterns ingested successfully',
      patternsIngested: additionalPatterns.length + 10 // 10 from common phrases
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search booking pattern endpoint
router.get('/admin/search/booking-pattern', async (req, res) => {
  try {
    if (!AppointmentBookingMemory) {
      return res.status(500).json({
        success: false,
        error: 'AppointmentBookingMemory service not available'
      });
    }
    
    const { q: query } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required'
      });
    }
    
    const bookingMemory = new AppointmentBookingMemory();
    const intelligence = await bookingMemory.getBookingIntelligence(query);
    
    res.json({
      success: true,
      query,
      intelligence,
      interpretation: intelligence.confident ? 
        `${intelligence.suggestedDay} at ${intelligence.suggestedTime}` : 
        'No confident match found'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Memory System Health Check Endpoint
router.get('/health/memory', async (req, res) => {
  try {
    if (config.ENABLE_MEMORY) {
      try {
        const memoryService = new RAGMemoryService();
        const stats = await memoryService.getMemoryStats();
        
        res.json({
          memoryEnabled: true,
          memoryHealthy: true,
          testMode: config.MEMORY_TEST_MODE,
          betaCustomers: config.MEMORY_BETA_CUSTOMERS.length,
          rolloutPercentage: config.MEMORY_ROLLOUT_PERCENTAGE,
          knowledgeSystemAvailable: !!DocumentIngestionService,
          handlerAvailable: true,
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
        message: 'Memory system is disabled',
        reason: 'ENABLE_MEMORY is false'
      });
    }
  } catch (error) {
    res.status(500).json({
      memoryEnabled: false,
      error: error.message
    });
  }
});

// NEXELLA KNOWLEDGE ENDPOINTS

// Search specifically in Nexella knowledge base
router.get('/admin/search/nexella-knowledge', async (req, res) => {
  try {
    const { q: query, limit = 5 } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required'
      });
    }
    
    if (!RAGMemoryService) {
      return res.status(500).json({
        success: false,
        error: 'Memory service not available'
      });
    }
    
    const memoryService = new RAGMemoryService();
    const queryEmbedding = await memoryService.createEmbedding(query);
    
    const searchResults = await memoryService.index.query({
      vector: queryEmbedding,
      filter: {
        source: { $eq: 'nexella_knowledge' }
      },
      topK: parseInt(limit),
      includeMetadata: true
    });
    
    const results = memoryService.processSearchResults(searchResults);
    
    res.json({
      success: true,
      query,
      results: results.map(r => ({
        content: r.content.substring(0, 200) + '...',
        score: r.score,
        type: r.memoryType,
        metadata: r.metadata,
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

// Force re-ingestion of Nexella knowledge (for testing)
router.post('/admin/ingest/nexella-force', async (req, res) => {
  try {
    console.log('🔄 Force re-ingesting Nexella knowledge base...');
    
    if (!DocumentIngestionService) {
      return res.status(500).json({
        success: false,
        error: 'Document ingestion service not available'
      });
    }
    
    const ingestionService = new DocumentIngestionService();
    const result = await ingestionService.ingestNexellaKnowledgeBase();
    
    res.json({
      success: result.success,
      message: result.success ? 'Nexella knowledge base re-ingested successfully' : 'Ingestion failed',
      totalItems: result.totalItems,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Admin endpoint to manually ingest Nexella knowledge
router.post('/admin/ingest/nexella-knowledge', async (req, res) => {
  try {
    console.log('🏢 Manually ingesting Nexella knowledge base...');
    
    if (!DocumentIngestionService) {
      return res.status(500).json({
        success: false,
        error: 'Document ingestion service not available'
      });
    }
    
    const ingestionService = new DocumentIngestionService();
    const result = await ingestionService.ingestNexellaKnowledgeBase();
    
    res.json({
      success: result.success,
      message: result.success ? 'Nexella knowledge base ingested successfully' : 'Ingestion failed',
      totalItems: result.totalItems,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ingest Nexella pain point solutions into memory
router.post('/admin/ingest/pain-point-solutions', async (req, res) => {
  try {
    if (!RAGMemoryService) {
      return res.status(503).json({
        success: false,
        error: 'Memory service not available'
      });
    }
    
    const memoryService = new RAGMemoryService();
    
    // Pain point solution mappings
    const painPointSolutions = [
      {
        pain_point: "We're not generating enough leads",
        solutions: "AI Texting captures website visitors instantly, SMS Revive wakes up your old database, and Review Collector boosts your online reputation to attract more leads organically.",
        services: ["AI Texting", "SMS Revive", "Review Collector"]
      },
      {
        pain_point: "We're not following up with leads quickly enough",
        solutions: "Our AI responds to every lead within seconds, 24/7. AI Voice Calls handle phone inquiries instantly, SMS Follow-Ups nurture leads automatically, and Appointment Bookings schedule meetings without any manual work.",
        services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"]
      },
      {
        pain_point: "We're not speaking to qualified leads",
        solutions: "Our AI qualification system asks YOUR exact qualifying questions before ever booking an appointment. Plus, everything integrates with your CRM to track lead quality and conversion rates.",
        services: ["AI Qualification System", "CRM Integration"]
      },
      {
        pain_point: "We miss calls too much",
        solutions: "Our AI Voice system answers every call 24/7/365 - nights, weekends, holidays. If someone can't talk, we automatically text them to continue the conversation. You'll never miss another opportunity.",
        services: ["AI Voice Calls", "SMS Follow-Ups"]
      },
      {
        pain_point: "We can't handle the amount of leads",
        solutions: "Our complete automation suite handles unlimited leads simultaneously. Every lead gets instant attention, proper qualification, and automatic scheduling. Your CRM stays updated automatically so nothing falls through the cracks.",
        services: ["Complete Automation Suite", "CRM Integration"]
      },
      {
        pain_point: "A mix of everything above",
        solutions: "Our Complete AI Revenue Rescue System solves ALL these problems with one integrated solution. Your leads get instant responses, proper qualification, automatic follow-up, and seamless appointment booking - all while you sleep!",
        services: ["Complete AI Revenue Rescue System"]
      }
    ];
    
    let storedCount = 0;
    
    for (const solution of painPointSolutions) {
      const content = `Pain Point: ${solution.pain_point}. Solution: ${solution.solutions} Services: ${solution.services.join(', ')}`;
      const embedding = await memoryService.createEmbedding(content);
      
      await memoryService.storeMemories([{
        id: `pain_solution_${solution.pain_point.replace(/\s+/g, '_').toLowerCase()}`,
        values: embedding,
        metadata: {
          memory_type: 'pain_point_solution',
          pain_point: solution.pain_point,
          solution_description: solution.solutions,
          recommended_services: solution.services,
          source: 'nexella_knowledge',
          timestamp: new Date().toISOString(),
          content: content
        }
      }]);
      
      storedCount++;
    }
    
    res.json({
      success: true,
      message: 'Pain point solutions ingested successfully',
      count: storedCount
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get memory stats
router.get('/admin/memory/stats', async (req, res) => {
  try {
    if (!RAGMemoryService) {
      return res.status(500).json({
        success: false,
        error: 'Memory service not available'
      });
    }
    
    const memoryService = new RAGMemoryService();
    const stats = await memoryService.getMemoryStats();
    
    res.json({
      success: true,
      stats,
      pineconeIndex: config.PINECONE_INDEX_NAME || 'nexella-memory'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test memory retrieval for a customer
router.get('/admin/memory/customer/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!RAGMemoryService) {
      return res.status(500).json({
        success: false,
        error: 'Memory service not available'
      });
    }
    
    const memoryService = new RAGMemoryService();
    
    const profile = await memoryService.getCustomerContext(email);
    const memories = await memoryService.getMemoriesByType(email, 'customer_profile', 5);
    
    res.json({
      success: true,
      email,
      profile,
      recentMemories: memories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search company knowledge endpoint (from existing code)
router.get('/admin/search/knowledge', async (req, res) => {
  try {
    const { q: query, limit = 5 } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required'
      });
    }
    
    if (!DocumentIngestionService) {
      return res.status(500).json({
        success: false,
        error: 'Document ingestion service not available'
      });
    }
    
    const ingestionService = new DocumentIngestionService();
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

module.exports = router;
