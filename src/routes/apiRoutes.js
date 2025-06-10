// src/routes/apiRoutes.js - COMPLETE FILE WITH ALL DEBUG ENDPOINTS
const express = require('express');
const axios = require('axios');
const config = require('../config/environment');
const { storeContactInfoGlobally } = require('../services/webhooks/WebhookService');
const { isCalendarInitialized, autoBookAppointment, getAvailableTimeSlots } = require('../services/calendar/CalendarHelpers');

const router = express.Router();

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
          'Test Customer',
          'test@example.com',
          '+1234567890',
          bookingDate,
          { test: 'This is a test booking' }
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

// Add other existing endpoints here...
// (HTTP Request - Trigger Retell Call, Retell webhook handler, etc.)

module.exports = router;
