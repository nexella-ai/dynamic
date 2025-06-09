// src/routes/apiRoutes.js - COMPLETE FILE WITH CALENDAR TESTING
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
      privateKey: config.GOOGLE_PRIVATE_KEY ? 'SET' : 'MISSING'
    }
  });
});

// NEW: Calendar debug endpoint
router.get('/debug/calendar', async (req, res) => {
  try {
    console.log('🔍 DEBUGGING CALENDAR SETUP');
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: {
        GOOGLE_PROJECT_ID: config.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING',
        GOOGLE_PRIVATE_KEY: config.GOOGLE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING',
        GOOGLE_CLIENT_EMAIL: config.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING',
        GOOGLE_CALENDAR_ID: config.GOOGLE_CALENDAR_ID || 'primary (default)'
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

// NEW: COMPREHENSIVE Calendar test endpoint
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
      GOOGLE_CALENDAR_ID: config.GOOGLE_CALENDAR_ID || 'primary',
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
            calendarId: config.GOOGLE_CALENDAR_ID || 'primary'
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
            calendarId: config.GOOGLE_CALENDAR_ID || 'primary',
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
    
    // 5. Test actual booking
    if (results.authentication.initialized && req.query.testBooking === 'true') {
      try {
        const { autoBookAppointment } = require('../services/calendar/CalendarHelpers');
        
        // Book for tomorrow at 10 AM
        const bookingDate = new Date();
        bookingDate.setDate(bookingDate.getDate() + 1);
        bookingDate.setHours(10, 0, 0, 0);
        
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
          console.log('🎉 TEST BOOKING CREATED:', bookingResult.eventId);
          
          // Try to delete the test event
          try {
            const calendarService = getCalendarService();
            const { google } = require('googleapis');
            const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
            
            await calendar.events.delete({
              calendarId: config.GOOGLE_CALENDAR_ID || 'primary',
              eventId: bookingResult.eventId
            });
            results.booking.cleanup = '✅ Test event deleted';
          } catch (deleteError) {
            results.booking.cleanup = '⚠️ Could not delete test event';
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
      results.summary.issues.push(`Calendar not shared with service account: ${config.GOOGLE_CLIENT_EMAIL}`);
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

// NEW: Test booking endpoint
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
          timezone: result.timezone || 'America/Phoenix'
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

// NEW: Set customer data endpoint - for N8N to send Typeform data
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

// NEW: Typeform webhook handler - alternative way to receive Typeform data
router.post('/typeform-webhook', express.json(), async (req, res) => {
  try {
    console.log('📋 Received Typeform webhook:', JSON.stringify(req.body, null, 2));
    
    const { form_response } = req.body;
    
    if (!form_response) {
      return res.status(400).json({ success: false, error: 'No form_response found' });
    }
    
    // Extract data from Typeform response
    let email = '';
    let name = '';
    let phone = '';
    
    // Parse Typeform answers
    if (form_response.answers) {
      form_response.answers.forEach(answer => {
        console.log('📝 Processing Typeform answer:', answer);
        
        // Email field
        if (answer.type === 'email' || answer.field?.title?.toLowerCase().includes('email')) {
          email = answer.email || answer.text || '';
        }
        
        // Name field  
        if (answer.field?.title?.toLowerCase().includes('name') || 
            answer.field?.ref?.toLowerCase().includes('name')) {
          name = answer.text || '';
        }
        
        // Phone field
        if (answer.type === 'phone_number' || 
            answer.field?.title?.toLowerCase().includes('phone')) {
          phone = answer.phone_number || answer.text || '';
        }
      });
    }
    
    console.log('📋 Extracted Typeform data:', { email, name, phone });
    
    if (email) {
      // Store globally for the next call
      storeContactInfoGlobally(name, email, phone, 'Typeform Webhook');
      
      console.log('✅ Typeform data stored successfully');
      res.status(200).json({ 
        success: true, 
        message: 'Typeform data received and stored',
        data: { email, name, phone }
      });
    } else {
      console.warn('⚠️ No email found in Typeform submission');
      res.status(400).json({ 
        success: false, 
        error: 'No email found in Typeform submission' 
      });
    }
    
  } catch (error) {
    console.error('❌ Error processing Typeform webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// NEW: Debug endpoint to check stored customer data
router.get('/debug-customer-data', (req, res) => {
  res.json({
    hasGlobalTypeformData: !!global.lastTypeformSubmission,
    globalData: global.lastTypeformSubmission || null,
    timestamp: new Date().toISOString()
  });
});

// NEW: Debug endpoint to manually clear customer data
router.post('/clear-customer-data', (req, res) => {
  global.lastTypeformSubmission = null;
  console.log('🧹 Cleared global customer data');
  res.json({ 
    success: true, 
    message: 'Customer data cleared' 
  });
});

// HTTP Request - Trigger Retell Call
router.post('/trigger-retell-call', express.json(), async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    console.log(`Received request to trigger Retell call for ${name} (${email})`);
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    const userIdentifier = userId || `user_${phone || Date.now()}`;
    console.log('Call request data:', { name, email, phone, userIdentifier });
    
    // Store contact info globally AND add to call metadata
    storeContactInfoGlobally(name, email, phone, 'API Call');
    
    // Also add to call metadata for this specific call
    const { addCallMetadata } = require('../services/webhooks/WebhookService');
    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    addCallMetadata(callId, {
      customer_email: email,
      customer_name: name,
      customer_phone: phone,
      user_identifier: userIdentifier,
      source: 'API Call'
    });
    
    const metadata = {
      customer_name: name || '',
      customer_email: email,
      customer_phone: phone || '',
      call_id: callId
    };
    
    console.log('Setting up call with metadata:', metadata);
    
    const initialVariables = {
      customer_name: name || '',
      customer_email: email
    };
    
    const response = await axios.post('https://api.retellai.com/v1/calls', 
      {
        agent_id: config.RETELL_AGENT_ID,
        customer_number: phone,
        variables: initialVariables,
        metadata
      },
      {
        headers: {
          'Authorization': `Bearer ${config.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Successfully triggered Retell call: ${response.data.call_id}`);
    res.status(200).json({ 
      success: true, 
      call_id: response.data.call_id,
      message: `Call initiated for ${name || email}`,
      stored_data: {
        global: !!global.lastTypeformSubmission,
        metadata: true
      }
    });
    
  } catch (error) {
    console.error('Error triggering Retell call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Unknown error triggering call' 
    });
  }
});

// Retell webhook handler
router.post('/retell-webhook', express.json(), async (req, res) => {
  try {
    const { event, call } = req.body;
    
    console.log(`Received Retell webhook event: ${event}`);
    
    if (call && call.call_id) {
      console.log(`Call ID: ${call.call_id}, Status: ${call.call_status}`);
      
      const email = call.metadata?.customer_email || '';
      const name = call.metadata?.customer_name || '';
      const phone = call.to_number || '';
      let preferredDay = '';
      let discoveryData = {};
      
      if (email) {
        storeContactInfoGlobally(name, email, phone, 'Retell Webhook');
      }
      
      // Extract scheduling and discovery data
      if (call.variables && call.variables.preferredDay) {
        preferredDay = call.variables.preferredDay;
      } else if (call.custom_data && call.custom_data.preferredDay) {
        preferredDay = call.custom_data.preferredDay;
      } else if (call.analysis && call.analysis.custom_data) {
        try {
          const customData = typeof call.analysis.custom_data === 'string'
            ? JSON.parse(call.analysis.custom_data)
            : call.analysis.custom_data;
            
          if (customData.preferredDay) {
            preferredDay = customData.preferredDay;
          }
        } catch (error) {
          console.error('Error parsing custom data:', error);
        }
      }
      
      if (call.variables) {
        Object.entries(call.variables).forEach(([key, value]) => {
          if (key.startsWith('discovery_') || key.includes('question_')) {
            discoveryData[key] = value;
          }
        });
      }
      
      if (call.custom_data && call.custom_data.discovery_data) {
        try {
          const parsedData = typeof call.custom_data.discovery_data === 'string' 
            ? JSON.parse(call.custom_data.discovery_data)
            : call.custom_data.discovery_data;
            
          discoveryData = { ...discoveryData, ...parsedData };
        } catch (error) {
          console.error('Error parsing discovery data from custom_data:', error);
        }
      }
      
      // Extract from transcript if no other discovery data found
      if (Object.keys(discoveryData).length === 0 && call.transcript && call.transcript.length > 0) {
        const discoveryQuestions = [
          'How did you hear about us?',
          'What industry or business are you in?',
          'What\'s your main product?',
          'Are you running ads right now?',
          'Are you using a CRM system?',
          'What pain points are you experiencing?'
        ];
        
        call.transcript.forEach((item, index) => {
          if (item.role === 'assistant') {
            const botMessage = item.content.toLowerCase();
            
            discoveryQuestions.forEach((question, qIndex) => {
              if (botMessage.includes(question.toLowerCase().substring(0, 15))) {
                if (call.transcript[index + 1] && call.transcript[index + 1].role === 'user') {
                  const answer = call.transcript[index + 1].content;
                  discoveryData[`question_${qIndex}`] = answer;
                }
              }
            });
          }
        });
      }
      
      if ((event === 'call_ended' || event === 'call_analyzed') && email) {
        console.log(`Sending webhook for ${event} event with discovery data:`, discoveryData);
        
        try {
          const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');
          
          await sendSchedulingPreference(
            name,
            email,
            phone,
            preferredDay || 'Not specified',
            call.call_id,
            discoveryData
          );
          
          console.log(`Successfully sent webhook for ${event}`);
        } catch (error) {
          console.error(`Error sending webhook for ${event}:`, error);
        }
      }
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error handling Retell webhook:', error);
    res.status(500).json({ success: false, error: error.message });
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
      calendarId: config.GOOGLE_CALENDAR_ID || 'primary (default)'
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

module.exports = router;
