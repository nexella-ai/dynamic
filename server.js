require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Ensure we have the required environment variables
if (!process.env.TRIGGER_SERVER_URL) {
  process.env. TRIGGER_SERVER_URL = 'https://trigger-server-qt7u.onrender.com';
}
if (!process.env.N8N_WEBHOOK_URL) {
  process.env.N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/6db89b9b-bbe3-4de8-95b3-2336f027006e';
}

// Store the latest Typeform submission for reference
global.lastTypeformSubmission = null;

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with Calendly scheduling link integration is live!');
});

// Store active calls metadata
const activeCallsMetadata = new Map();

// Enhanced function to store contact info globally with multiple fallbacks
function storeContactInfoGlobally(name, email, phone, source = 'Unknown') {
  console.log(`📝 Storing contact info globally from ${source}:`, { name, email, phone });
  
  // Always update if we have an email
  if (email && email.trim() !== '') {
    global.lastTypeformSubmission = {
      timestamp: new Date().toISOString(),
      email: email.trim(),
      name: (name || '').trim(),
      phone: (phone || '').trim(),
      source: source
    };
    console.log('✅ Stored contact info globally:', global.lastTypeformSubmission);
    return true;
  } else {
    console.warn('⚠️ Cannot store contact info - missing email');
    return false;
  }
}

// For checking slot availability with our trigger server
async function checkAvailability(startTime, endTime) {
  try {
    const response = await axios.get(`${process.env.TRIGGER_SERVER_URL}/check-availability`, {
      params: { startTime, endTime }
    });
    return response.data.available;
  } catch (error) {
    console.error('Error checking availability:', error.message);
    return false;
  }
}

// For getting available time slots from Calendly (through your trigger server)
async function getAvailableTimeSlots(date) {
  try {
    const formattedDate = new Date(date).toISOString().split('T')[0];
    const response = await axios.get(`${process.env.TRIGGER_SERVER_URL}/available-slots`, {
      params: { date: formattedDate }
    });
    return response.data.availableSlots || [];
  } catch (error) {
    console.error('Error getting available slots:', error.message);
    return [];
  }
}

// Update conversation state in trigger server
async function updateConversationState(callId, discoveryComplete, preferredDay) {
  try {
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/update-conversation`, {
      call_id: callId,
      discoveryComplete,
      preferredDay
    });
    console.log(`Updated conversation state for call ${callId}:`, response.data);
    return response.data.success;
  } catch (error) {
    console.error('Error updating conversation state:', error);
    return false;
  }
}

// ENHANCED: Send scheduling data with proper email handling - MULTIPLE SOURCES
async function sendSchedulingPreference(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    console.log('=== ENHANCED WEBHOOK SENDING DEBUG ===');
    console.log('Input parameters:', { name, email, phone, preferredDay, callId });
    console.log('Raw discovery data input:', JSON.stringify(discoveryData, null, 2));
    console.log('Discovery data keys:', Object.keys(discoveryData));
    console.log('Global Typeform submission:', global.lastTypeformSubmission);
    
    // ENHANCED: Try multiple methods to get email
    let finalEmail = email;
    let finalName = name;
    let finalPhone = phone;
    
    // Method 1: Use provided email if valid
    if (finalEmail && finalEmail.trim() !== '') {
      console.log(`Using provided email: ${finalEmail}`);
    }
    // Method 2: Get from global Typeform submission
    else if (global.lastTypeformSubmission && global.lastTypeformSubmission.email) {
      finalEmail = global.lastTypeformSubmission.email;
      console.log(`Using email from global Typeform: ${finalEmail}`);
    }
    // Method 3: Get from call metadata if available
    else if (callId && activeCallsMetadata.has(callId)) {
      const callMetadata = activeCallsMetadata.get(callId);
      if (callMetadata && callMetadata.customer_email) {
        finalEmail = callMetadata.customer_email;
        console.log(`Using email from call metadata: ${finalEmail}`);
      }
    }
    
    // Enhanced name and phone retrieval
    if (!finalName || finalName.trim() === '') {
      if (global.lastTypeformSubmission && global.lastTypeformSubmission.name) {
        finalName = global.lastTypeformSubmission.name;
      } else if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        if (callMetadata && callMetadata.customer_name) {
          finalName = callMetadata.customer_name;
        }
      }
    }
    
    if (!finalPhone || finalPhone.trim() === '') {
      if (global.lastTypeformSubmission && global.lastTypeformSubmission.phone) {
        finalPhone = global.lastTypeformSubmission.phone;
      } else if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        if (callMetadata && (callMetadata.phone || callMetadata.to_number)) {
          finalPhone = callMetadata.phone || callMetadata.to_number;
        }
      }
    }
    
    console.log(`Final contact info - Email: "${finalEmail}", Name: "${finalName}", Phone: "${finalPhone}"`);
    
    // CRITICAL: Don't proceed if we still don't have an email
    if (!finalEmail || finalEmail.trim() === '') {
      console.error('❌ CRITICAL: No email found from any source. Cannot send webhook.');
      console.error('❌ Email sources checked:');
      console.error(`   - global.lastTypeformSubmission: ${global.lastTypeformSubmission?.email || 'null'}`);
      console.error(`   - connectionData.customerEmail: ${connectionData.customerEmail || 'null'}`);
      console.error(`   - bookingInfo.email: ${bookingInfo.email || 'null'}`);
      console.error(`   - activeCallsMetadata for callId: ${activeCallsMetadata.get(callId)?.customer_email || 'null'}`);
      return { success: false, error: 'No email address available' };
    }
    
    // ENHANCED: Process discovery data with better field mapping
    console.log('🔧 PROCESSING DISCOVERY DATA:');
    console.log('Raw discoveryData input:', JSON.stringify(discoveryData, null, 2));
    
    // Initialize formatted discovery data
    const formattedDiscoveryData = {};
    
    // Define field mappings from question keys to Airtable field names
    const fieldMappings = {
      'question_0': 'Current Ownership Status',
      'question_1': 'Ideal Price Range', 
      'question_2': 'Timeline to Buy',
      'question_3': 'Home Type Preference',
      'question_4': 'Must-Haves and Deal-Breakers',
      'question_5': 'Current Agent Status'
    };
    
    // Process all discovery data
    Object.entries(discoveryData).forEach(([key, value]) => {
      console.log(`🔧 Processing key: "${key}" with value: "${value}"`);
      
      if (value && typeof value === 'string' && value.trim() !== '') {
        const trimmedValue = value.trim();
        
        if (key.startsWith('question_') && fieldMappings[key]) {
          // Map question_X to the exact Airtable field name
          formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          console.log(`✅ Mapped ${key} -> "${fieldMappings[key]}" = "${trimmedValue}"`);
        } else if (key === 'Current Ownership Status' || key.includes('ownership') || key.includes('renting') || key.includes('own')) {
          formattedDiscoveryData['Current Ownership Status'] = trimmedValue;
          console.log(`✅ Direct mapping: Current Ownership Status = "${trimmedValue}"`);
        } else if (key === 'Ideal Price Range' || key.includes('price') || key.includes('budget')) {
          // Only map if we don't already have it from question_1
          if (!formattedDiscoveryData['Ideal Price Range']) {
            formattedDiscoveryData['Ideal Price Range'] = trimmedValue;
            console.log(`✅ Direct mapping: Ideal Price Range = "${trimmedValue}"`);
          }
        } else if (key === 'Timeline to Buy' || key.includes('timeline') || key.includes('soon')) {
          if (!formattedDiscoveryData['Timeline to Buy']) {
            formattedDiscoveryData['Timeline to Buy'] = trimmedValue;
            console.log(`✅ Direct mapping: Timeline to Buy = "${trimmedValue}"`);
          }
        } else if (key === 'Home Type Preference' || key.includes('home') || key.includes('house') || key.includes('type')) {
          if (!formattedDiscoveryData['Home Type Preference']) {
            formattedDiscoveryData['Home Type Preference'] = trimmedValue;
            console.log(`✅ Direct mapping: Home Type Preference = "${trimmedValue}"`);
          }
        } else if (key === 'Must-Haves and Deal-Breakers' || key.includes('must') || key.includes('deal-breaker')) {
          if (!formattedDiscoveryData['Must-Haves and Deal-Breakers']) {
            formattedDiscoveryData['Must-Haves and Deal-Breakers'] = trimmedValue;
            console.log(`✅ Direct mapping: Must-Haves and Deal-Breakers = "${trimmedValue}"`);
          }
        } else if (key === 'Current Agent Status' || key.includes('agent') || key.includes('realtor')) {
          if (!formattedDiscoveryData['Current Agent Status']) {
            formattedDiscoveryData['Current Agent Status'] = trimmedValue;
            console.log(`✅ Direct mapping: Current Agent Status = "${trimmedValue}"`);
          }
        } else {
          // Keep original key if it doesn't match any pattern
          formattedDiscoveryData[key] = trimmedValue;
          console.log(`📝 Keeping original key: ${key} = "${trimmedValue}"`);
        }
      }
    });
    
    console.log('🔧 FINAL FORMATTED DISCOVERY DATA:', JSON.stringify(formattedDiscoveryData, null, 2));
    console.log('📊 Total discovery fields captured:', Object.keys(formattedDiscoveryData).length);
    
    // Ensure phone number is formatted properly
    if (finalPhone && !finalPhone.startsWith('+')) {
      finalPhone = '+1' + finalPhone.replace(/[^0-9]/g, '');
    }
    
    // Create the webhook payload
    const webhookData = {
      name: finalName || '',
      email: finalEmail, // This is now guaranteed to have a value
      phone: finalPhone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData,
      formatted_discovery: formattedDiscoveryData, // Send both for compatibility
      // Also include individual fields for direct access
      "Current Ownership Status": formattedDiscoveryData["Current Ownership Status"] || '',
      "Ideal Price Range": formattedDiscoveryData["Ideal Price Range"] || '',
      "Timeline to Buy": formattedDiscoveryData["Timeline to Buy"] || '',
      "Home Type Preference": formattedDiscoveryData["Home Type Preference"] || '',
      "Must-Haves and Deal-Breakers": formattedDiscoveryData["Must-Haves and Deal-Breakers"] || '',
      "Current Agent Status": formattedDiscoveryData["Current Agent Status"] || ''
    };
    
    console.log('📤 COMPLETE WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    console.log('✅ Sending scheduling preference to trigger server');
    console.log('🎯 Trigger server URL:', process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com');
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Scheduling preference sent successfully:', response.data);
    console.log('✅ Trigger server response status:', response.status);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error('❌ Error sending scheduling preference:', error);
    
    // Enhanced fallback to n8n with same data processing
    try {
      console.log('🔄 Attempting to send directly to n8n webhook as fallback');
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/6db89b9b-bbe3-4de8-95b3-2336f027006e';
      
      // Use the same processing logic for fallback
      let fallbackEmail = email || (global.lastTypeformSubmission && global.lastTypeformSubmission.email) || '';
      let fallbackName = name || (global.lastTypeformSubmission && global.lastTypeformSubmission.name) || '';
      let fallbackPhone = phone || (global.lastTypeformSubmission && global.lastTypeformSubmission.phone) || '';
      
      if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        fallbackEmail = fallbackEmail || callMetadata?.customer_email || '';
        fallbackName = fallbackName || callMetadata?.customer_name || '';
        fallbackPhone = fallbackPhone || callMetadata?.phone || callMetadata?.to_number || '';
      }
      
      // Process discovery data for fallback (same logic)
      const formattedDiscoveryData = {};
      const fieldMappings = {
        'question_0': 'Current Ownership Status',
        'question_1': 'Ideal Price Range',
        'question_2': 'Timeline to Buy',
        'question_3': 'Home Type Preference',
        'question_4': 'Must-Haves and Deal-Breakers',
        'question_5': 'Current Agent Status'
      };
      
      Object.entries(discoveryData).forEach(([key, value]) => {
        if (value && typeof value === 'string' && value.trim() !== '') {
          const trimmedValue = value.trim();
          if (key.startsWith('question_') && fieldMappings[key]) {
            formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          } else if (key === 'Current Ownership Status' || key.includes('ownership')) {
            formattedDiscoveryData['Current Ownership Status'] = trimmedValue;
          } else if (key === 'Ideal Price Range' || key.includes('price') || key.includes('budget')) {
            formattedDiscoveryData['Ideal Price Range'] = trimmedValue;
          } else if (key === 'Timeline to Buy' || key.includes('timeline')) {
            formattedDiscoveryData['Timeline to Buy'] = trimmedValue;
          } else if (key === 'Home Type Preference' || key.includes('home')) {
            formattedDiscoveryData['Home Type Preference'] = trimmedValue;
          } else if (key === 'Must-Haves and Deal-Breakers' || key.includes('must')) {
            formattedDiscoveryData['Must-Haves and Deal-Breakers'] = trimmedValue;
          } else if (key === 'Current Agent Status' || key.includes('agent')) {
            formattedDiscoveryData['Current Agent Status'] = trimmedValue;
          } else {
            formattedDiscoveryData[key] = trimmedValue;
          }
        }
      });
      
      const fallbackWebhookData = {
        name: fallbackName,
        email: fallbackEmail,
        phone: fallbackPhone,
        preferredDay: preferredDay || '',
        call_id: callId || '',
        schedulingComplete: true,
        discovery_data: formattedDiscoveryData,
        formatted_discovery: formattedDiscoveryData,
        "Current Ownership Status": formattedDiscoveryData["Current Ownership Status"] || '',
        "Ideal Price Range": formattedDiscoveryData["Ideal Price Range"] || '',
        "Timeline to Buy": formattedDiscoveryData["Timeline to Buy"] || '',
        "Home Type Preference": formattedDiscoveryData["Home Type Preference"] || '',
        "Must-Haves and Deal-Breakers": formattedDiscoveryData["Must-Haves and Deal-Breakers"] || '',
        "Current Agent Status": formattedDiscoveryData["Current Agent Status"] || ''
      };
      
      console.log('🔄 Fallback webhook data:', JSON.stringify(fallbackWebhookData, null, 2));
      console.log('🔄 Sending to N8N URL:', n8nWebhookUrl);
      
      const n8nResponse = await axios.post(n8nWebhookUrl, fallbackWebhookData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      console.log('✅ Successfully sent directly to n8n:', n8nResponse.data);
      console.log('✅ N8N Response status:', n8nResponse.status);
      return { success: true, fallback: true };
      
    } catch (n8nError) {
      console.error('❌ Error sending directly to n8n:', n8nError);
      console.error('❌ N8N URL used:', n8nWebhookUrl);
      console.error('❌ N8N payload sent:', JSON.stringify(fallbackWebhookData, null, 2));
      return { success: false, error: error.message };
    }
  }
}

// IMPROVED: Better detection of scheduling preferences
function handleSchedulingPreference(userMessage) {
  // Extract day of week with better handling for various formats
  const dayMatch = userMessage.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today/i);
  const nextWeekMatch = userMessage.match(/next week/i);
  
  if (nextWeekMatch) {
    // Handle "next week" specifically
    let targetDate = new Date();
    // Add 7 days to get to next week, then adjust to Monday
    targetDate.setDate(targetDate.getDate() + 7);
    
    // Get next Monday (if we're already past Monday this week)
    const dayOfWeek = targetDate.getDay();
    const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
    targetDate.setDate(targetDate.getDate() + daysUntilMonday - 7);
    
    return {
      dayName: 'next week',
      date: targetDate,
      isSpecific: false
    };
  } else if (dayMatch) {
    const preferredDay = dayMatch[0].toLowerCase();
    
    let targetDate = new Date();
    
    // Handle relative day references
    if (preferredDay === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
      return {
        dayName: 'tomorrow',
        date: targetDate,
        isSpecific: true
      };
    } else if (preferredDay === 'today') {
      return {
        dayName: 'today',
        date: targetDate,
        isSpecific: true
      };
    } else {
      // Handle specific day of week
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const requestedDayIndex = daysOfWeek.findIndex(d => d === preferredDay);
      
      if (requestedDayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = requestedDayIndex - currentDay;
        
        // If the requested day is earlier in the week than today, go to next week
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        
        return {
          dayName: preferredDay,
          date: targetDate,
          isSpecific: true
        };
      }
    }
  }
  
  return null;
}

// HTTP Request - Trigger Retell Call
// This endpoint initiates the call with Retell
app.post('/trigger-retell-call', express.json(), async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    console.log(`Received request to trigger Retell call for ${name} (${email})`);
    
    // Check if we have all required fields
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    // Ensure we have a unique user ID
    const userIdentifier = userId || `user_${phone || Date.now()}`;
    
    // Log the incoming request data
    console.log('Call request data:', { name, email, phone, userIdentifier });
    
    // ENHANCED: Store the data globally immediately
    storeContactInfoGlobally(name, email, phone, 'API Call');
    
    // Set up metadata for the Retell call
    // This is how we'll pass customer information to the voice agent
    const metadata = {
      customer_name: name || '',  // Ensure name is passed to agent
      customer_email: email,      // Always include email
      customer_phone: phone || '' // Include phone if available
    };
    
    // Log the metadata we're sending to Retell
    console.log('Setting up call with metadata:', metadata);
    
    // Prevent fallback to "Monica" by setting a variable directly in the agent
    const initialVariables = {
      customer_name: name || '',
      customer_email: email
    };
    
    // Make call to Retell API
    const response = await axios.post('https://api.retellai.com/v1/calls', 
      {
        agent_id: process.env.RETELL_AGENT_ID,
        customer_number: phone,
        // Set LLM variables to pass customer info (may need Retell update to use)
        variables: initialVariables,
        // Pass metadata which will be available in WebSocket connection
        metadata
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
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

// ENHANCED WEBSOCKET CONNECTION HANDLER - FIXED DISCOVERY SYSTEM WITH DELAYED ANSWER CAPTURE
wss.on('connection', async (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION ESTABLISHED');
  console.log('Connection URL:', req.url);
  
  // Extract call ID from URL
  const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
  const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
  
  console.log('📞 Extracted Call ID:', callId);
  
  // Store connection data with this WebSocket
  const connectionData = {
    callId: callId,
    metadata: null,
    customerEmail: null,
    customerName: null,
    customerPhone: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };

  // NEW: Simplified delayed answer capture variables
  let answerCaptureTimer = null;
  let userResponseBuffer = [];
  let isCapturingAnswer = false; // Prevent multiple captures

  // Try to fetch call metadata but don't block if it fails
  if (callId) {
    try {
      console.log('🔍 Fetching metadata for call:', callId);
      const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
      
      // Try multiple possible endpoints
      const possibleEndpoints = [
        `${TRIGGER_SERVER_URL}/api/get-call-data/${callId}`,
        `${TRIGGER_SERVER_URL}/get-call-info/${callId}`,
        `${TRIGGER_SERVER_URL}/call-data/${callId}`,
        `${TRIGGER_SERVER_URL}/api/call/${callId}`
      ];
      
      let metadataFetched = false;
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying endpoint: ${endpoint}`);
          const response = await fetch(endpoint, { 
            timeout: 3000,
            headers: {
              'Content-Type': 'application/json'
            }
          });
          if (response.ok) {
            const callData = await response.json();
            console.log('📋 Retrieved call metadata:', callData);
            
            // Handle nested response structure
            const actualData = callData.data || callData;
            connectionData.metadata = actualData;
            
            // Extract data from metadata - handle both direct and nested structure
            connectionData.customerEmail = actualData.email || actualData.customer_email || actualData.user_email || 
                                         (actualData.metadata && actualData.metadata.customer_email);
            connectionData.customerName = actualData.name || actualData.customer_name || actualData.user_name ||
                                        (actualData.metadata && actualData.metadata.customer_name);
            connectionData.customerPhone = actualData.phone || actualData.customer_phone || actualData.to_number ||
                                         (actualData.metadata && actualData.metadata.customer_phone);
            
            console.log('📧 Extracted from metadata:', {
              email: connectionData.customerEmail,
              name: connectionData.customerName,
              phone: connectionData.customerPhone
            });
            
            // Check if this is an appointment confirmation call
            if (callData.call_type === 'appointment_confirmation') {
              connectionData.isAppointmentConfirmation = true;
              console.log('📅 This is an APPOINTMENT CONFIRMATION call');
            }
            
            metadataFetched = true;
            break;
          }
        } catch (endpointError) {
          console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
        }
      }
      
      if (!metadataFetched) {
        console.log('⚠️ Could not fetch metadata from any endpoint - will try to get from WebSocket messages');
      }
      
    } catch (error) {
      console.log('❌ Error fetching call metadata:', error.message);
      console.log('🔄 Will extract data from WebSocket messages instead');
    }
  }
  
  console.log('Retell connected via WebSocket.');
  
  // SIMPLIFIED: Discovery questions system
  const discoveryQuestions = [
    { question: 'Are you currently renting or do you own?', field: 'Current Ownership Status', asked: false, answered: false, answer: '' },
    { question: 'What\'s your ideal price range?', field: 'Ideal Price Range', asked: false, answered: false, answer: '' },
    { question: 'How soon are you looking to buy?', field: 'Timeline to Buy', asked: false, answered: false, answer: '' },
    { question: 'What type of home are you looking for?', field: 'Home Type Preference', asked: false, answered: false, answer: '' },
    { question: 'Are there any must-haves or deal-breakers?', field: 'Must-Haves and Deal-Breakers', asked: false, answered: false, answer: '' },
    { question: 'Are you working with another agent currently?', field: 'Current Agent Status', asked: false, answered: false, answer: '' }
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: -1,
    questionsCompleted: 0,
    allQuestionsCompleted: false,
    waitingForAnswer: false,
    lastAcknowledgment: '' // Track last acknowledgment used
  };

  // Function to generate contextual acknowledgments based on user's answer
  function getContextualAcknowledgment(userAnswer, questionIndex) {
    const answer = userAnswer.toLowerCase();
    
    switch (questionIndex) {
      case 0: // Are you currently renting or do you own?
        if (answer.includes('rent') || answer.includes('renting')) {
          return "Currently renting, perfect! That's great timing to buy.";
        } else if (answer.includes('own') || answer.includes('owner')) {
          return "You already own, excellent! Looking to upgrade or relocate?";
        } else {
          return "Great, thanks for sharing that.";
        }
        
      case 1: // What's your ideal price range?
        if (answer.includes('k') || answer.includes('thousand')) {
          return "Got it, that's a solid budget range.";
        } else if (answer.includes('million')) {
          return "Perfect, luxury market it is!";
        } else if (answer.includes('flexible') || answer.includes('depends')) {
          return "Flexible budget, that gives us good options.";
        } else {
          return "Great, I understand your price range.";
        }
        
      case 2: // How soon are you looking to buy?
        if (answer.includes('soon') || answer.includes('month') || answer.includes('asap')) {
          return "Looking to move quickly, perfect timing!";
        } else if (answer.includes('year') || answer.includes('six month')) {
          return "Good timeline, that gives us time to find the perfect home.";
        } else if (answer.includes('flexible') || answer.includes('right')) {
          return "Waiting for the right property, smart approach.";
        } else {
          return "Perfect, I understand your timeline.";
        }
        
      case 3: // What type of home are you looking for?
        if (answer.includes('house') || answer.includes('single family')) {
          return "Single family home, excellent choice!";
        } else if (answer.includes('condo') || answer.includes('townhouse')) {
          return "Condo or townhouse, great options for today's market.";
        } else if (answer.includes('apartment')) {
          return "Apartment style living, perfect!";
        } else {
          return "Got it, that sounds like a great fit for you.";
        }
        
      case 4: // Are there any must-haves or deal-breakers?
        if (answer.includes('pool') || answer.includes('yard')) {
          return "Outdoor space is so important, I totally get that.";
        } else if (answer.includes('school') || answer.includes('district')) {
          return "Good schools are crucial, especially for families.";
        } else if (answer.includes('garage') || answer.includes('parking')) {
          return "Parking is definitely important, especially in busy areas.";
        } else if (answer.includes('updated') || answer.includes('modern')) {
          return "Updated features save so much time and hassle.";
        } else {
          return "Those are important considerations for sure.";
        }
        
      case 5: // Are you working with another agent currently?
        if (answer.includes('yes') || answer.includes('working with')) {
          return "I see, it's always good to explore your options.";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "Perfect, I'd love to help you with your home search.";
        } else if (answer.includes('looking') || answer.includes('considering')) {
          return "Smart to do your research on agents.";
        } else {
          return "Got it, thanks for letting me know.";
        }
        
      default:
        return "Perfect, thank you.";
    }
  }

  // SIMPLIFIED QUESTION DETECTION
  function detectQuestionAsked(botMessage) {
    const botContent = botMessage.toLowerCase();
    
    // Only look for the next question that hasn't been asked yet
    const nextQuestionIndex = discoveryQuestions.findIndex(q => !q.asked);
    
    if (nextQuestionIndex === -1) {
      console.log('✅ All questions have been asked');
      return false;
    }
    
    // Don't detect new questions if we're already waiting for an answer
    if (discoveryProgress.waitingForAnswer) {
      console.log(`⚠️ Already waiting for answer to question ${discoveryProgress.currentQuestionIndex + 1} - ignoring detection`);
      return false;
    }
    
    const nextQuestion = discoveryQuestions[nextQuestionIndex];
    let detected = false;
    
    // Simple keyword detection for each question
    switch (nextQuestionIndex) {
      case 0: // Are you currently renting or do you own?
        detected = (botContent.includes('renting') || botContent.includes('rent')) && botContent.includes('own');
        break;
      case 1: // What's your ideal price range?
        detected = (botContent.includes('price') || botContent.includes('budget')) && botContent.includes('range');
        break;
      case 2: // How soon are you looking to buy?
        detected = botContent.includes('soon') || (botContent.includes('looking') && botContent.includes('buy'));
        break;
      case 3: // What type of home are you looking for?
        detected = (botContent.includes('type') && botContent.includes('home')) || (botContent.includes('looking') && botContent.includes('for'));
        break;
      case 4: // Are there any must-haves or deal-breakers?
        detected = botContent.includes('must-have') || botContent.includes('deal-breaker') || (botContent.includes('any') && (botContent.includes('must') || botContent.includes('deal')));
        break;
      case 5: // Are you working with another agent currently?
        detected = (botContent.includes('working') && botContent.includes('agent')) || (botContent.includes('another') && botContent.includes('agent'));
        break;
    }
    
    if (detected) {
      console.log(`✅ DETECTED Question ${nextQuestionIndex + 1}: "${nextQuestion.question}"`);
      nextQuestion.asked = true;
      discoveryProgress.currentQuestionIndex = nextQuestionIndex;
      discoveryProgress.waitingForAnswer = true;
      userResponseBuffer = []; // Reset buffer
      return true;
    }
    
    return false;
  }

  // SIMPLIFIED ANSWER CAPTURE
  function captureUserAnswer(userMessage) {
    if (!discoveryProgress.waitingForAnswer || isCapturingAnswer) {
      return;
    }
    
    const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
    if (!currentQ || currentQ.answered) {
      return;
    }
    
    console.log(`📝 Buffering answer for Q${discoveryProgress.currentQuestionIndex + 1}: "${userMessage}"`);
    
    // Add to buffer
    userResponseBuffer.push(userMessage.trim());
    
    // Clear existing timer
    if (answerCaptureTimer) {
      clearTimeout(answerCaptureTimer);
    }
    
    // Set new timer
    answerCaptureTimer = setTimeout(() => {
      if (isCapturingAnswer) return; // Prevent double capture
      
      isCapturingAnswer = true;
      
      // Combine all responses
      const completeAnswer = userResponseBuffer.join(' ');
      
      // Store the answer
      currentQ.answered = true;
      currentQ.answer = completeAnswer;
      discoveryData[currentQ.field] = completeAnswer;
      discoveryData[`question_${discoveryProgress.currentQuestionIndex}`] = completeAnswer;
      
      // Update progress
      discoveryProgress.questionsCompleted++;
      discoveryProgress.waitingForAnswer = false;
      discoveryProgress.allQuestionsCompleted = discoveryQuestions.every(q => q.answered);
      
      console.log(`✅ CAPTURED Q${discoveryProgress.currentQuestionIndex + 1}: "${completeAnswer}"`);
      console.log(`📊 Progress: ${discoveryProgress.questionsCompleted}/6 questions completed`);
      
      // NEW: Check if all questions are completed and send webhook immediately
      if (discoveryProgress.allQuestionsCompleted && discoveryProgress.questionsCompleted === 6) {
        console.log('🎯 ALL 6 QUESTIONS COMPLETED - Triggering immediate webhook check');
        
        // Set a flag to trigger webhook on next message processing
        setTimeout(() => {
          if (!webhookSent && (bookingInfo.email || connectionData.customerEmail)) {
            console.log('🚀 IMMEDIATE WEBHOOK SEND - All discovery complete');
            
            const immediateDiscoveryData = {};
            discoveryQuestions.forEach((q, index) => {
              if (q.answered && q.answer) {
                immediateDiscoveryData[q.field] = q.answer;
                immediateDiscoveryData[`question_${index}`] = q.answer;
              }
            });
            
            sendSchedulingPreference(
              bookingInfo.name || connectionData.customerName || '',
              bookingInfo.email || connectionData.customerEmail || '',
              bookingInfo.phone || connectionData.customerPhone || '',
              'All discovery questions completed',
              connectionData.callId,
              immediateDiscoveryData
            ).then(result => {
              if (result.success) {
                webhookSent = true;
                console.log('✅ Immediate webhook sent successfully after all questions completed');
              }
            }).catch(error => {
              console.error('❌ Immediate webhook failed:', error.message);
            });
          }
        }, 1000); // 1 second delay to allow processing
      }
      
      // Reset
      userResponseBuffer = [];
      isCapturingAnswer = false;
      answerCaptureTimer = null;
      
    }, 3000);
  }

  // UPDATED: Improved system prompt with better greeting flow
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a real estate agent named "Emma". Always introduce yourself as Emma, your local real estate expert.

CONVERSATION FLOW:
1. GREETING PHASE: Start with a warm greeting and ask how they're doing
2. BRIEF CHAT: Engage in 1-2 exchanges of pleasantries before discovery
3. TRANSITION: Naturally transition to discovery questions about their home buying needs
4. DISCOVERY PHASE: Ask all 6 discovery questions systematically
5. SCHEDULING PHASE: Only after all 6 questions are complete

GREETING & TRANSITION GUIDELINES:
- Always start with: "Hi there! This is Emma, your local real estate expert. How are you doing today?"
- When they respond to how they're doing, acknowledge it warmly
- After 1-2 friendly exchanges, transition naturally with something like:
  "That's wonderful to hear! I'd love to learn more about what you're looking for in your home search so I can better help you."
- Then start with the first discovery question

CRITICAL DISCOVERY REQUIREMENTS:
- You MUST ask ALL 6 discovery questions in the exact order listed below
- Ask ONE question at a time and wait for the customer's response
- Do NOT move to scheduling until ALL 6 questions are answered
- After each answer, acknowledge it briefly before asking the next question

DISCOVERY QUESTIONS (ask in this EXACT order):
1. "Are you currently renting or do you own?"
2. "What's your ideal price range?"
3. "How soon are you looking to buy?"
4. "What type of home are you looking for?"
5. "Are there any must-haves or deal-breakers?"
6. "Are you working with another agent currently?"

SPEAKING STYLE & PACING:
- Speak at a SLOW, measured pace - never rush your words
- Insert natural pauses between sentences using periods (.)
- Complete all your sentences fully - never cut off mid-thought
- Use shorter sentences rather than long, complex ones
- Keep your statements and questions concise but complete

PERSONALITY & TONE:
- Be warm and friendly but speak in a calm, measured way
- Use a consistent, even speaking tone throughout the conversation
- Use contractions and everyday language that sounds natural
- Maintain a calm, professional demeanor at all times
- If you ask a question with a question mark '?' go up in pitch and tone towards the end of the sentence.
- If you respond with "." always keep an even consistent tone towards the end of the sentence.

DISCOVERY FLOW:
- Only start discovery questions AFTER greeting exchange is complete
- After each answer, acknowledge it briefly with varied responses like:
  * "Perfect, thank you."
  * "Got it, that's helpful."
  * "Great, I understand."
  * "Excellent, thank you."
  * "That makes sense."
  * "Wonderful, thanks."
  * "I see, that's very helpful."
  * "Perfect, understood."
  * "Awesome, got it."
- CRITICAL: Never use the same acknowledgment twice in a row
- Keep acknowledgments short and natural
- Then immediately ask the next question
- Do NOT skip questions or assume answers
- Count your questions mentally: 1, 2, 3, 4, 5, 6

SCHEDULING APPROACH:
- ONLY after asking ALL 6 discovery questions, ask for scheduling preference
- Say: "Perfect! I have all the information I need about your home search. Let's schedule a time to discuss properties that match your criteria. What day would work best for you?"
- When they mention a day, acknowledge it and confirm scheduling

Remember: Start with greeting, have brief pleasant conversation, then systematically complete ALL 6 discovery questions before any scheduling discussion.`
    }
  ];

  // States for conversation flow
  let conversationState = 'introduction';
  let bookingInfo = {
    name: connectionData.customerName || '',
    email: connectionData.customerEmail || '',
    phone: connectionData.customerPhone || '',
    preferredDay: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let discoveryData = {}; // This will store the final answers
  let collectedContactInfo = !!connectionData.customerEmail;
  let userHasSpoken = false;
  let webhookSent = false;

  // Send connecting message
  ws.send(JSON.stringify({
    content: "Hi there",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  // Send auto-greeting after a short delay
  setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending auto-greeting message');
      ws.send(JSON.stringify({
        content: "Hi there! This is Emma, your local real estate expert. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 4000); // Increased to 4 seconds for complete greeting

  // Set a timer for auto-greeting if user doesn't speak first
  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending backup auto-greeting');
      ws.send(JSON.stringify({
        content: "Hello! This is Emma, your local real estate expert. I'm here to help you find your perfect home today. How's everything going?",
        content_complete: true,
        actions: [],
        response_id: 2
      }));
    }
  }, 8000); // Increased to 8 seconds to avoid overlap

  // ENHANCED: Message handling with delayed answer capture
  ws.on('message', async (data) => {
    try {
      clearTimeout(autoGreetingTimer);
      userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      console.log('📥 Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      // Debug logging to see what we're receiving
      console.log('WebSocket message type:', parsed.interaction_type || 'unknown');
      if (parsed.call) {
        console.log('Call data structure:', JSON.stringify(parsed.call, null, 2));
      }
      
      // Extract call info from WebSocket messages first
      if (parsed.call && parsed.call.call_id) {
        if (!connectionData.callId) {
          connectionData.callId = parsed.call.call_id;
          console.log(`🔗 Got call ID from WebSocket: ${connectionData.callId}`);
        }
        
        // Extract metadata from call object
        if (parsed.call.metadata) {
          console.log('📞 Call metadata from WebSocket:', JSON.stringify(parsed.call.metadata, null, 2));
          
          if (!connectionData.customerEmail && parsed.call.metadata.customer_email) {
            connectionData.customerEmail = parsed.call.metadata.customer_email;
            bookingInfo.email = connectionData.customerEmail;
            console.log(`✅ Got email from WebSocket metadata: ${connectionData.customerEmail}`);
          }
          
          if (!connectionData.customerName && parsed.call.metadata.customer_name) {
            connectionData.customerName = parsed.call.metadata.customer_name;
            bookingInfo.name = connectionData.customerName;
            console.log(`✅ Got name from WebSocket metadata: ${connectionData.customerName}`);
          }
          
          if (!connectionData.customerPhone && (parsed.call.metadata.customer_phone || parsed.call.to_number)) {
            connectionData.customerPhone = parsed.call.metadata.customer_phone || parsed.call.to_number;
            bookingInfo.phone = connectionData.customerPhone;
            console.log(`✅ Got phone from WebSocket metadata: ${connectionData.customerPhone}`);
          }
        }
        
        // Extract phone from call object if not in metadata
        if (!connectionData.customerPhone && parsed.call.to_number) {
          connectionData.customerPhone = parsed.call.to_number;
          bookingInfo.phone = connectionData.customerPhone;
          console.log(`✅ Got phone from call object: ${connectionData.customerPhone}`);
        }
        
        // Store in active calls metadata map
        activeCallsMetadata.set(connectionData.callId, {
          customer_email: connectionData.customerEmail,
          customer_name: connectionData.customerName,
          phone: connectionData.customerPhone,
          to_number: connectionData.customerPhone
        });
        
        collectedContactInfo = !!connectionData.customerEmail;
      }
      
      // ENHANCED: Get contact info when we connect to a call (BACKUP METHOD)
      if (parsed.call && parsed.call.call_id && !collectedContactInfo) {
        // FIRST: Try to get contact info from trigger server using call_id
        try {
          console.log('📞 Fetching contact info from trigger server...');
          const triggerResponse = await axios.get(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/get-call-info/${connectionData.callId}`, {
            timeout: 5000
          });
          
          if (triggerResponse.data && triggerResponse.data.success) {
            const callInfo = triggerResponse.data.data;
            if (!bookingInfo.email) bookingInfo.email = callInfo.email || '';
            if (!bookingInfo.name) bookingInfo.name = callInfo.name || '';
            if (!bookingInfo.phone) bookingInfo.phone = callInfo.phone || '';
            collectedContactInfo = true;
            
            console.log('✅ Got contact info from trigger server:', {
              name: bookingInfo.name,
              email: bookingInfo.email,
              phone: bookingInfo.phone
            });
            
            // Update system prompt with the actual customer name if we have it
            if (bookingInfo.name) {
              const systemPrompt = conversationHistory[0].content;
              conversationHistory[0].content = systemPrompt
                .replace(/\[Name\]/g, bookingInfo.name);
              console.log(`Updated system prompt with customer name: ${bookingInfo.name}`);
            }
          }
        } catch (triggerError) {
          console.log('⚠️ Could not fetch contact info from trigger server:', triggerError.message);
        }
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('🗣️ User said:', userMessage);
        console.log('🔄 Current conversation state:', conversationState);
        console.log('📊 Discovery progress:', discoveryProgress);

        // SIMPLIFIED: Question detection
        if (conversationHistory.length >= 2) {
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            detectQuestionAsked(lastBotMessage.content);
          }
        }

        // SIMPLIFIED: Answer capture
        if (discoveryProgress.waitingForAnswer && userMessage.trim().length > 2) {
          captureUserAnswer(userMessage);
        }

        // Check for scheduling preference (only after ALL questions are answered)
        let schedulingDetected = false;
        if (discoveryProgress.allQuestionsCompleted && 
            userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/)) {
          
          console.log('🗓️ User mentioned scheduling after completing ALL discovery questions');
          
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo && !webhookSent) {
            bookingInfo.preferredDay = dayInfo.dayName;
            schedulingDetected = true;
          }
        } else if (!discoveryProgress.allQuestionsCompleted && 
                   userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
          console.log('⚠️ User mentioned scheduling but discovery is not complete. Continuing with questions.');
        }

        // Add user message to conversation history
        conversationHistory.push({ role: 'user', content: userMessage });

        // SIMPLIFIED: Better context for GPT with question tracking
        let contextPrompt = '';
        if (!discoveryProgress.allQuestionsCompleted) {
          const nextUnanswered = discoveryQuestions.find(q => !q.answered);
          if (nextUnanswered) {
            const questionNumber = discoveryQuestions.indexOf(nextUnanswered) + 1;
            const completed = discoveryQuestions.filter(q => q.answered).map((q, i) => `${discoveryQuestions.indexOf(q) + 1}. ${q.question} ✓`).join('\n');
            
            // Check if user just answered a question
            const lastAnsweredQ = discoveryQuestions.find(q => q.asked && q.answered && q.answer);
            let acknowledgmentInstruction = '';
            
            if (lastAnsweredQ && discoveryProgress.questionsCompleted > 0) {
              const lastQuestionIndex = discoveryQuestions.indexOf(lastAnsweredQ);
              const suggestedAck = getContextualAcknowledgment(lastAnsweredQ.answer, lastQuestionIndex);
              acknowledgmentInstruction = `\n\nThe user just answered: "${lastAnsweredQ.answer}"
Acknowledge this with: "${suggestedAck}" then ask the next question.`;
            }
            
            contextPrompt = `\n\nDISCOVERY STATUS:
COMPLETED (${discoveryProgress.questionsCompleted}/6):
${completed || 'None yet'}

NEXT TO ASK:
${questionNumber}. ${nextUnanswered.question}${acknowledgmentInstruction}

CRITICAL: Ask question ${questionNumber} next. Do NOT repeat completed questions. Do NOT skip to scheduling until all 6 are done.`;
          }
        } else {
          contextPrompt = '\n\nAll 6 discovery questions completed. Proceed to scheduling.';
        }

        // Process with GPT
        const messages = [...conversationHistory];
        if (contextPrompt) {
          messages[messages.length - 1].content += contextPrompt;
        }

        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: messages,
            temperature: 0.7
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 8000
          }
        );

        const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me a bit more about that?";

        // Add bot reply to conversation history (without context prompt)
        conversationHistory.push({ role: 'assistant', content: botReply });

        // Update conversation state
        if (conversationState === 'introduction') {
          conversationState = 'discovery';
        } else if (conversationState === 'discovery' && discoveryProgress.allQuestionsCompleted) {
          conversationState = 'booking';
          console.log('🔄 Transitioning to booking state - ALL 6 discovery questions completed');
        }

        // Send the AI response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
        // ENHANCED: Send webhook when all discovery is complete (regardless of scheduling mention)
        if (discoveryProgress.allQuestionsCompleted && discoveryProgress.questionsCompleted === 6 && !webhookSent) {
          console.log('🚀 ATTEMPTING WEBHOOK - All discovery questions completed:');
          console.log('   ✅ All 6 discovery questions completed and answered');
          
          // Check for contact info more aggressively
          const finalEmail = bookingInfo.email || connectionData.customerEmail || global.lastTypeformSubmission?.email || '';
          const finalName = bookingInfo.name || connectionData.customerName || global.lastTypeformSubmission?.name || '';
          const finalPhone = bookingInfo.phone || connectionData.customerPhone || global.lastTypeformSubmission?.phone || '';
          
          console.log('📧 Contact info check:');
          console.log(`   Email: "${finalEmail}"`);
          console.log(`   Name: "${finalName}"`);
          console.log(`   Phone: "${finalPhone}"`);
          console.log(`   Call ID: "${connectionData.callId}"`);
          
          if (finalEmail && finalEmail.trim() !== '') {
            console.log('   ✅ Email available - proceeding with webhook');
            
            // Final validation of discovery data
            const finalDiscoveryData = {};
            discoveryQuestions.forEach((q, index) => {
              if (q.answered && q.answer) {
                finalDiscoveryData[q.field] = q.answer;
                finalDiscoveryData[`question_${index}`] = q.answer;
              }
            });
            
            console.log('📋 Final discovery data being sent:', JSON.stringify(finalDiscoveryData, null, 2));
            
            try {
              const result = await sendSchedulingPreference(
                finalName,
                finalEmail,
                finalPhone,
                bookingInfo.preferredDay || 'Discovery completed',
                connectionData.callId,
                finalDiscoveryData
              );
              
              if (result.success) {
                webhookSent = true;
                conversationState = 'completed';
                console.log('✅ Webhook sent successfully with all discovery data');
                console.log('✅ WEBHOOK STATUS: webhookSent = true');
              } else {
                console.error('❌ Webhook failed:', result.error);
                console.log('⚠️ WEBHOOK STATUS: webhookSent remains false due to failure');
              }
            } catch (webhookError) {
              console.error('❌ Webhook exception:', webhookError.message);
              console.log('⚠️ WEBHOOK STATUS: webhookSent remains false due to exception');
            }
          } else {
            console.warn('⚠️ No email available - cannot send webhook yet');
            console.log('📊 Available data sources:');
            console.log('   bookingInfo:', JSON.stringify(bookingInfo, null, 2));
            console.log('   connectionData email:', connectionData.customerEmail);
            console.log('   global.lastTypeformSubmission:', global.lastTypeformSubmission);
            console.log('⚠️ WEBHOOK STATUS: webhookSent remains false - no email');
            
            // DON'T mark as sent if no email - let it try again later
          }
        } else if (discoveryProgress.allQuestionsCompleted && webhookSent) {
          console.log('🔄 All discovery complete but webhook already marked as sent');
          console.log(`   webhookSent status: ${webhookSent}`);
        }
        
        // ORIGINAL: Also check for explicit scheduling mention
        if (schedulingDetected && discoveryProgress.allQuestionsCompleted && !webhookSent) {
          console.log('🚀 SENDING WEBHOOK - Scheduling explicitly mentioned:');
          console.log('   ✅ All 6 discovery questions completed and answered');
          console.log('   ✅ Scheduling preference detected');
          console.log('   ✅ Contact info available');
          
          // Final validation of discovery data
          const finalDiscoveryData = {};
          discoveryQuestions.forEach((q, index) => {
            if (q.answered && q.answer) {
              finalDiscoveryData[q.field] = q.answer;
              finalDiscoveryData[`question_${index}`] = q.answer;
            }
          });
          
          console.log('📋 Final discovery data being sent:', JSON.stringify(finalDiscoveryData, null, 2));
          
          const result = await sendSchedulingPreference(
            bookingInfo.name || connectionData.customerName || '',
            bookingInfo.email || connectionData.customerEmail || '',
            bookingInfo.phone || connectionData.customerPhone || '',
            bookingInfo.preferredDay,
            connectionData.callId,
            finalDiscoveryData
          );
          
          if (result.success) {
            webhookSent = true;
            conversationState = 'completed';
            console.log('✅ Webhook sent successfully with all discovery data');
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      
      // Enhanced emergency webhook logic - Send if we have substantial discovery data
      if (!webhookSent && connectionData.callId && 
          (bookingInfo.email || connectionData.customerEmail) &&
          discoveryProgress.questionsCompleted >= 3) {
        try {
          console.log('🚨 EMERGENCY WEBHOOK SEND - Substantial discovery data available');
          
          // Create emergency discovery data from what we have
          const emergencyDiscoveryData = {};
          discoveryQuestions.forEach((q, index) => {
            if (q.answered && q.answer) {
              emergencyDiscoveryData[q.field] = q.answer;
              emergencyDiscoveryData[`question_${index}`] = q.answer;
            }
          });
          
          await sendSchedulingPreference(
            bookingInfo.name || connectionData.customerName || '',
            bookingInfo.email || connectionData.customerEmail || '',
            bookingInfo.phone || connectionData.customerPhone || '',
            bookingInfo.preferredDay || 'Error occurred - discovery data captured',
            connectionData.callId,
            emergencyDiscoveryData
          );
          webhookSent = true;
          console.log('✅ Emergency webhook sent with available discovery data');
        } catch (webhookError) {
          console.error('❌ Emergency webhook also failed:', webhookError.message);
        }
      }
      
      // Send a recovery message
      ws.send(JSON.stringify({
        content: "I missed that. Could you repeat it?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });

  ws.on('close', async () => {
    console.log('🔌 Connection closed.');
    clearTimeout(autoGreetingTimer);
    
    // Clear any pending answer capture timer
    if (answerCaptureTimer) {
      clearTimeout(answerCaptureTimer);
      console.log('🧹 Cleared pending answer capture timer');
    }
    
    // If we have a pending answer in the buffer, capture it now
    if (userResponseBuffer.length > 0 && discoveryProgress.waitingForAnswer) {
      const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
      if (currentQ && !currentQ.answered) {
        const completeAnswer = userResponseBuffer.join(' ');
        currentQ.answered = true;
        currentQ.answer = completeAnswer;
        discoveryData[currentQ.field] = completeAnswer;
        discoveryData[`question_${discoveryProgress.currentQuestionIndex}`] = completeAnswer;
        discoveryProgress.questionsCompleted++;
        console.log(`🔌 Captured buffered answer on close: "${completeAnswer}"`);
      }
    }
    
    console.log('=== FINAL CONNECTION CLOSE ANALYSIS ===');
    console.log('📋 Final discoveryData:', JSON.stringify(discoveryData, null, 2));
    console.log('📊 Questions completed:', discoveryProgress.questionsCompleted);
    console.log('📊 All questions completed:', discoveryProgress.allQuestionsCompleted);
    
    // Detailed breakdown of each question
    discoveryQuestions.forEach((q, index) => {
      console.log(`Question ${index + 1}: Asked=${q.asked}, Answered=${q.answered}, Answer="${q.answer}"`);
    });
    
    // FORCE WEBHOOK ATTEMPT - Always try when we have complete discovery data, even if marked as sent
    if (connectionData.callId && discoveryProgress.questionsCompleted >= 6) {
      try {
        console.log('🚨 FORCING WEBHOOK ATTEMPT - Complete discovery data available');
        console.log(`   Previous webhookSent status: ${webhookSent}`);
        
        // Try ALL possible sources for email - BE MORE AGGRESSIVE
        let finalEmail = connectionData.customerEmail || 
                        bookingInfo.email || 
                        global.lastTypeformSubmission?.email || 
                        '';
        
        // Check activeCallsMetadata too
        if (!finalEmail && connectionData.callId && activeCallsMetadata.has(connectionData.callId)) {
          const callMetadata = activeCallsMetadata.get(connectionData.callId);
          finalEmail = callMetadata?.customer_email || '';
          console.log(`   Found email in activeCallsMetadata: ${finalEmail}`);
        }
        
        const finalName = connectionData.customerName || 
                         bookingInfo.name || 
                         global.lastTypeformSubmission?.name || 
                         '';
        const finalPhone = connectionData.customerPhone || 
                          bookingInfo.phone || 
                          global.lastTypeformSubmission?.phone || 
                          '';
        
        console.log('🚨 FORCE WEBHOOK - Contact info:');
        console.log(`   Email: "${finalEmail}"`);
        console.log(`   Name: "${finalName}"`);
        console.log(`   Phone: "${finalPhone}"`);
        console.log(`   Call ID: "${connectionData.callId}"`);
        
        // Only proceed if we have an email
        if (!finalEmail || finalEmail.trim() === '') {
          console.error('❌ FORCE WEBHOOK SKIPPED: No email address found');
          console.error('❌ Email sources checked:');
          console.error(`   - connectionData.customerEmail: ${connectionData.customerEmail || 'null'}`);
          console.error(`   - bookingInfo.email: ${bookingInfo.email || 'null'}`);
          console.error(`   - global.lastTypeformSubmission?.email: ${global.lastTypeformSubmission?.email || 'null'}`);
          console.error(`   - activeCallsMetadata: ${activeCallsMetadata.get(connectionData.callId)?.customer_email || 'null'}`);
          return;
        }
        
        // Create final discovery data from answered questions
        const finalDiscoveryData = {};
        discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
        console.log('🚨 FORCE WEBHOOK - Discovery data:', JSON.stringify(finalDiscoveryData, null, 2));
        
        // FORCE the webhook call
        console.log('🔄 FORCING webhook call...');
        const result = await sendSchedulingPreference(
          finalName,
          finalEmail,
          finalPhone,
          'FORCED SEND - Discovery completed',
          connectionData.callId,
          finalDiscoveryData
        );
        
        console.log('📤 FORCE WEBHOOK result:', JSON.stringify(result, null, 2));
        
        if (result.success) {
          console.log('✅ FORCE webhook sent successfully');
        } else {
          console.error('❌ FORCE webhook failed:', result.error || 'Unknown error');
        }
      } catch (finalError) {
        console.error('❌ FORCE webhook exception:', finalError.message);
        console.error('❌ Full error stack:', finalError.stack);
      }
    }
    
    // Clean up
    if (connectionData.callId) {
      activeCallsMetadata.delete(connectionData.callId);
      console.log(`🧹 Cleaned up metadata for call ${connectionData.callId}`);
    }
  });
});

// Add error handling for WebSocket server
wss.on('error', (error) => {
  console.error('❌ WebSocket Server Error:', error);
});

server.on('error', (error) => {
  console.error('❌ HTTP Server Error:', error);
});

// Endpoint to receive Retell webhook call events
app.post('/retell-webhook', express.json(), async (req, res) => {
  try {
    const { event, call } = req.body;
    
    console.log(`Received Retell webhook event: ${event}`);
    
    if (call && call.call_id) {
      console.log(`Call ID: ${call.call_id}, Status: ${call.call_status}`);
      
      // Extract important call information
      const email = call.metadata?.customer_email || '';
      const name = call.metadata?.customer_name || '';
      const phone = call.to_number || '';
      let preferredDay = '';
      let discoveryData = {};
      
      // Store this info globally as well
      if (email) {
        storeContactInfoGlobally(name, email, phone, 'Retell Webhook');
      }
      
      // Look for preferred day in various locations
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
      
      // Extract discovery data from variables, transcript, and custom data
      if (call.variables) {
        // Extract discovery-related variables
        Object.entries(call.variables).forEach(([key, value]) => {
          if (key.startsWith('discovery_') || key.includes('question_')) {
            discoveryData[key] = value;
          }
        });
      }
      
      // Extract from custom_data if any
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
      
      // If no discovery data found yet, try to extract from transcript
      if (Object.keys(discoveryData).length === 0 && call.transcript && call.transcript.length > 0) {
        // Use the discovery questions to match answers in the transcript
        const discoveryQuestions = [
          'Are you currently renting or do you own?',
          'What\'s your ideal price range?',
          'How soon are you looking to buy?',
          'What type of home are you looking for?',
          'Are there any must-haves or deal-breakers?',
          'Are you working with another agent currently?'
        ];
        
        // Find questions and their answers in the transcript
        call.transcript.forEach((item, index) => {
          if (item.role === 'assistant') {
            const botMessage = item.content.toLowerCase();
            
            // Try to match with our known discovery questions
            discoveryQuestions.forEach((question, qIndex) => {
              // If this bot message contains a discovery question
              if (botMessage.includes(question.toLowerCase().substring(0, 15))) {
                // Check if next message is from the user (the answer)
                if (call.transcript[index + 1] && call.transcript[index + 1].role === 'user') {
                  const answer = call.transcript[index + 1].content;
                  discoveryData[`question_${qIndex}`] = answer;
                }
              }
            });
          }
        });
      }
      
      // Send webhook for call ending events
      if ((event === 'call_ended' || event === 'call_analyzed') && email) {
        console.log(`Sending webhook for ${event} event with discovery data:`, discoveryData);
        
        try {
          // Use the trigger server to route the webhook
          await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, {
            name,
            email,
            phone,
            preferredDay: preferredDay || 'Not specified',
            call_id: call.call_id,
            call_status: call.call_status,
            discovery_data: discoveryData,
            schedulingComplete: true
          });
          
          console.log(`Successfully sent webhook for ${event}`);
        } catch (error) {
          console.error(`Error sending webhook for ${event}:`, error);
        }
      }
      
      // Clean up any stored data
      activeCallsMetadata.delete(call.call_id);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error handling Retell webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server with Calendly scheduling link integration is listening on port ${PORT}`);
});
