require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Retell = require('retell-sdk').default; // ✅ FIXED: Correct package name
const { 
  lockSlot, 
  confirmSlot, 
  releaseSlot, 
  isSlotAvailable, 
  getAvailableSlots 
} = require('./slot-manager'); // ✅ Make sure this file exists

const app = express();
app.use(express.json());

// Set the default n8n webhook URL - UPDATED FOR N8N
const DEFAULT_N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';

// Helper function to parse a date string
function parseDate(dateStr) {
  try {
    // Handle common day formats
    const days = {
      'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
      'friday': 5, 'saturday': 6, 'sunday': 0,
      'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 0
    };
    
    const now = new Date();
    const currentDay = now.getDay();
    
    // Extract day from string
    let targetDay = null;
    for (const [dayName, dayNumber] of Object.entries(days)) {
      if (dateStr.toLowerCase().includes(dayName)) {
        targetDay = dayNumber;
        break;
      }
    }
    
    if (targetDay === null) {
      throw new Error(`Could not parse day from "${dateStr}"`);
    }
    
    // Calculate days to add
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) {
      daysToAdd += 7; // Move to next week if day has passed
    }
    
    // Create target date
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysToAdd);
    targetDate.setHours(0, 0, 0, 0);
    
    return {
      date: targetDate.toISOString(),
      formattedDate: targetDate.toLocaleDateString()
    };
  } catch (error) {
    console.error('Error parsing date:', error);
    throw new Error(`Failed to parse date "${dateStr}": ${error.message}`);
  }
}

// Enhanced helper function to send data to n8n webhook - UPDATED FOR N8N
async function notifyN8nWebhook(data) {
  console.log('🚀 PREPARING TO SEND DATA TO N8N WEBHOOK:', JSON.stringify(data, null, 2));
  
  try {
    // Format discovery data if present
    if (data.discovery_data) {
      // Format the discovery data into a structured format for Airtable
      const formattedDiscoveryData = {};
      
      // Map discovery questions to better field names
      const questionMapping = {
        'question_0': 'How did you hear about us',
        'question_1': 'Business/Industry',
        'question_2': 'Main product',
        'question_3': 'Running ads',
        'question_4': 'Using CRM',
        'question_5': 'Pain points'
      };
      
      // Process discovery data into formatted fields
      Object.entries(data.discovery_data).forEach(([key, value]) => {
        if (questionMapping[key]) {
          formattedDiscoveryData[questionMapping[key]] = value;
        } else {
          formattedDiscoveryData[key] = value;
        }
      });
      
      // Add formatted discovery data
      data.formatted_discovery = formattedDiscoveryData;
      
      // Create a formatted notes field combining all discovery answers
      let notes = "";
      Object.entries(formattedDiscoveryData).forEach(([question, answer]) => {
        notes += `${question}: ${answer}\n\n`;
      });
      
      // Add notes field for Airtable
      if (notes) {
        data.notes = notes.trim();
      }
    }
    
    // Add timestamp to webhook data
    const webhookData = {
      ...data,
      timestamp: new Date().toISOString(),
      webhook_version: '1.1'
    };
    
    console.log('📤 SENDING DATA TO N8N WEBHOOK:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(DEFAULT_N8N_WEBHOOK_URL, webhookData, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'Nexella-Server'
      }
    });
    
    console.log(`✅ DATA SENT TO N8N WEBHOOK. Response status: ${response.status}`);
    console.log(`✅ RESPONSE DETAILS:`, JSON.stringify(response.data || {}, null, 2));
    return true;
  } catch (error) {
    console.error(`❌ ERROR SENDING DATA TO N8N WEBHOOK: ${error.message}`);
    if (error.response) {
      console.error('❌ RESPONSE ERROR DETAILS:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    } else if (error.request) {
      console.error('❌ REQUEST ERROR: No response received', error.request);
    } else {
      console.error('❌ SETUP ERROR:', error.message);
    }
    
    // Retry logic
    console.log('🔄 Attempting to retry webhook notification in 3 seconds...');
    setTimeout(async () => {
      try {
        const retryResponse = await axios.post(DEFAULT_N8N_WEBHOOK_URL, data);
        console.log(`✅ RETRY SUCCESSFUL. Response status: ${retryResponse.status}`);
      } catch (retryError) {
        console.error(`❌ RETRY FAILED: ${retryError.message}`);
      }
    }, 3000);
    
    return false;
  }
}

// Initialize Retell SDK client
let retellClient = null;
try {
  retellClient = new Retell({
    apiKey: process.env.RETELL_API_KEY,
  });
  console.log('✅ Retell client initialized successfully');
} catch (error) {
  console.error('❌ Error initializing Retell client:', error.message);
}

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString();
  console.log(`${timestamp} ${req.method} ${req.path}`);
  next();
});

// Store active calls for tracking state
const activeCalls = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('Trigger server is healthy.');
});

// ALL YOUR OTHER ENDPOINTS FROM ORIGINAL FILE...
// (I'll include the key ones, but you should copy ALL endpoints from your original trigger-server (12).js)

// FIXED: Updated endpoint to trigger a Retell call using SDK with enhanced call storage
app.post('/trigger-retell-call', async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing phone number field" 
      });
    }
    
    console.log('Triggering Retell call with:', { name, email, phone });
    
    // Create a unique user ID
    const userIdentifier = userId || `user_${phone}`;
    
    // First try using the SDK
    if (retellClient) {
      try {
        const response = await retellClient.call.createPhoneCall({
          from_number: process.env.RETELL_FROM_NUMBER,
          to_number: phone,
          agent_id: process.env.RETELL_AGENT_ID,
          metadata: {
            customer_name: name || "",
            customer_email: email || "",
            user_id: userIdentifier,
            needs_scheduling: true,
            call_source: "website_form",
            n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL
          },
          webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
          webhook_events: ["call_ended", "call_analyzed"]
        });
        
        // Store the call in our active calls map WITH COMPLETE INFO
        const callId = response.call_id;
        activeCalls.set(callId, {
          id: callId,
          phone,
          name: name || "",
          email: email || "",
          userId: userIdentifier,
          startTime: Date.now(),
          state: 'initiated',
          discoveryComplete: false,
          schedulingComplete: false,
          metadata: {
            customer_name: name || "",
            customer_email: email || "",
            user_id: userIdentifier
          }
        });
        
        console.log('✅ Retell outbound call initiated with SDK:', response);
        console.log('✅ Stored call data with email:', email);
        
        return res.status(200).json({
          success: true,
          message: 'Outbound call initiated successfully',
          call_id: response.call_id
        });
      } catch (sdkError) {
        console.error('❌ SDK Error initiating Retell call:', sdkError);
        // Fall through to the axios fallback
      }
    }
    
    // Fallback to direct axios call if SDK fails or isn't initialized
    try {
      const response = await axios.post('https://api.retellai.com/v1/calls', {
        from_number: process.env.RETELL_FROM_NUMBER,
        to_number: phone,
        agent_id: process.env.RETELL_AGENT_ID,
        metadata: {
          customer_name: name || "",
          customer_email: email || "",
          user_id: userIdentifier,
          needs_scheduling: true,
          call_source: "website_form",
          n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL
        },
        webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
        webhook_events: ["call_ended", "call_analyzed"]
      }, {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Store the call in our active calls map WITH COMPLETE INFO
      const callId = response.data.call_id;
      activeCalls.set(callId, {
        id: callId,
        phone,
        name: name || "",
        email: email || "",
        userId: userIdentifier,
        startTime: Date.now(),
        state: 'initiated',
        discoveryComplete: false,
        schedulingComplete: false,
        metadata: {
          customer_name: name || "",
          customer_email: email || "",
          user_id: userIdentifier
        }
      });
      
      console.log('✅ Retell outbound call initiated with axios:', response.data);
      console.log('✅ Stored call data with email:', email);
      
      return res.status(200).json({
        success: true,
        message: 'Outbound call initiated successfully',
        call_id: response.data.call_id
      });
    } catch (error) {
      console.error('❌ Error initiating Retell call:', error.response?.data || error.message);
      return res.status(500).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
  } catch (error) {
    console.error('❌ Error in trigger-retell-call endpoint:', error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// COPY ALL OTHER ENDPOINTS FROM YOUR ORIGINAL trigger-server (12).js FILE HERE
// Including:
// - /send-scheduling-link
// - /process-scheduling-preference  
// - /retell-webhook
// - /update-conversation
// - /get-call-info/:callId
// - /manual-webhook
// - /debug-test-webhook
// - /test-n8n-flow
// - /debug-discovery-mapping
// - /test-retell-api
// - All slot management endpoints (/check-availability, /available-slots, /lock-slot, /release-slot)

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT}`);
});
