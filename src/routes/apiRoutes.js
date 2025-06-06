// src/routes/apiRoutes.js - API Route Handlers
const express = require('express');
const axios = require('axios');
const config = require('../config/environment');
const { storeContactInfoGlobally } = require('../services/webhooks/WebhookService');
const { isCalendarInitialized } = require('../services/calendar/CalendarHelpers');

const router = express.Router();

// Root endpoint
router.get('/', (req, res) => {
  const status = isCalendarInitialized() ? 'Real Calendar' : 'Demo Mode (add environment variables for real calendar)';
  res.send(`Nexella WebSocket Server is live! Status: ${status}`);
});

// Health check endpoint
router.get('/health', (req, res) => {
  const validation = config.validate();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: {
      hasOpenAI: !!config.OPENAI_API_KEY,
      hasRetell: !!config.RETELL_API_KEY,
      hasGoogleCalendar: validation.hasGoogleCalendar,
      calendarMode: validation.hasGoogleCalendar ? 'real' : 'demo'
    },
    validation: validation
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
    
    storeContactInfoGlobally(name, email, phone, 'API Call');
    
    const metadata = {
      customer_name: name || '',
      customer_email: email,
      customer_phone: phone || ''
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
      message: `Call initiated for ${name || email}`
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
    mode: isCalendarInitialized() ? 'real_calendar' : 'demo_mode'
  });
});

// Test endpoint for calendar functionality
router.get('/test-calendar', async (req, res) => {
  try {
    const { getAvailableTimeSlots } = require('../services/calendar/CalendarHelpers');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const slots = await getAvailableTimeSlots(tomorrow);
    
    res.json({
      success: true,
      date: tomorrow.toDateString(),
      availableSlots: slots,
      mode: isCalendarInitialized() ? 'real_calendar' : 'demo_mode'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;