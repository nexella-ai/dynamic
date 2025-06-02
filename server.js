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
  process.env.N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
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
        } else if (key === 'Current Ownership Status' || key.includes('rent') || key.includes('own')) {
          formattedDiscoveryData['Current Ownership Status'] = trimmedValue;
          console.log(`✅ Direct mapping: Current Ownership Status = "${trimmedValue}"`);
        } else if (key === 'Ideal Price Range' || key.includes('price') || key.includes('range') || key.includes('budget')) {
          // Only map if we don't already have it from question_1
          if (!formattedDiscoveryData['Ideal Price Range']) {
            formattedDiscoveryData['Ideal Price Range'] = trimmedValue;
            console.log(`✅ Direct mapping: Ideal Price Range = "${trimmedValue}"`);
          }
        } else if (key === 'Timeline to Buy' || key.includes('timeframe') || key.includes('soon') || key.includes('when')) {
          if (!formattedDiscoveryData['Timeline to Buy']) {
            formattedDiscoveryData['Timeline to Buy'] = trimmedValue;
            console.log(`✅ Direct mapping: Timeline to Buy = "${trimmedValue}"`);
          }
        } else if (key === 'Home Type Preference' || key.includes('home') || key.includes('type') || key.includes('house')) {
          if (!formattedDiscoveryData['Home Type Preference']) {
            formattedDiscoveryData['Home Type Preference'] = trimmedValue;
            console.log(`✅ Direct mapping: Home Type Preference = "${trimmedValue}"`);
          }
        } else if (key === 'Must-Haves and Deal-Breakers' || key.includes('must') || key.includes('deal') || key.includes('breaker')) {
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
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Scheduling preference sent successfully:', response.data);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error('❌ Error sending scheduling preference:', error);
    
    // Enhanced fallback to n8n with same data processing
    try {
      console.log('🔄 Attempting to send directly to n8n webhook as fallback');
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
      
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
          } else if (key === 'Current Ownership Status' || key.includes('rent') || key.includes('own')) {
            formattedDiscoveryData['Current Ownership Status'] = trimmedValue;
          } else if (key === 'Ideal Price Range' || key.includes('price') || key.includes('range') || key.includes('budget')) {
            formattedDiscoveryData['Ideal Price Range'] = trimmedValue;
          } else if (key === 'Timeline to Buy' || key.includes('timeframe') || key.includes('soon') || key.includes('when')) {
            formattedDiscoveryData['Timeline to Buy'] = trimmedValue;
          } else if (key === 'Home Type Preference' || key.includes('home') || key.includes('type') || key.includes('house')) {
            formattedDiscoveryData['Home Type Preference'] = trimmedValue;
          } else if (key === 'Must-Haves and Deal-Breakers' || key.includes('must') || key.includes('deal') || key.includes('breaker')) {
            formattedDiscoveryData['Must-Haves and Deal-Breakers'] = trimmedValue;
          } else if (key === 'Current Agent Status' || key.includes('agent') || key.includes('realtor')) {
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
      
      const n8nResponse = await axios.post(n8nWebhookUrl, fallbackWebhookData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      console.log('✅ Successfully sent directly to n8n:', n8nResponse.data);
      return { success: true, fallback: true };
      
    } catch (n8nError) {
      console.error('❌ Error sending directly to n8n:', n8nError);
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
          return "Got it, so you're currently renting.";
        } else if (answer.includes('own') || answer.includes('owner')) {
          return "I see, you currently own your home.";
        } else {
          return "Perfect, thanks for sharing that.";
        }
        
      case 1: // What's your ideal price range?
        if (answer.includes('$') || answer.includes('dollar') || answer.includes('k') || answer.includes('thousand')) {
          return "Great, that's a good budget to work with.";
        } else if (answer.includes('open') || answer.includes('flexible')) {
          return "Excellent, flexibility is always helpful.";
        } else {
          return "Perfect, I understand your price range.";
        }
        
      case 2: // How soon are you looking to buy?
        if (answer.includes('asap') || answer.includes('soon') || answer.includes('immediately')) {
          return "Wonderful, we can definitely move quickly for you.";
        } else if (answer.includes('month') || answer.includes('months')) {
          return "Great timeline, that gives us good time to find the right place.";
        } else if (answer.includes('year') || answer.includes('years')) {
          return "Perfect, we have time to find exactly what you're looking for.";
        } else {
          return "Got it, that's a good timeframe.";
        }
        
      case 3: // What type of home are you looking for?
        if (answer.includes('condo') || answer.includes('condominium')) {
          return "Condos are great! Low maintenance and often good amenities.";
        } else if (answer.includes('house') || answer.includes('single family')) {
          return "Single family homes are wonderful, more space and privacy.";
        } else if (answer.includes('townhouse') || answer.includes('townhome')) {
          return "Townhomes are fantastic, great balance of space and convenience.";
        } else {
          return "Excellent, I have a good sense of what you're looking for.";
        }
        
      case 4: // Are there any must-haves or deal-breakers?
        if (answer.includes('bedroom') || answer.includes('bath')) {
          return "Absolutely, bedroom and bathroom count is really important.";
        }
