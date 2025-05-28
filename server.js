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
  process.env.TRIGGER_SERVER_URL = 'https://trigger-server-qt7u.onrender.com';
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
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry', 
      'question_2': 'Main product',
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
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
        } else if (key === 'How did you hear about us' || key.includes('hear about')) {
          formattedDiscoveryData['How did you hear about us'] = trimmedValue;
          console.log(`✅ Direct mapping: How did you hear about us = "${trimmedValue}"`);
        } else if (key === 'Business/Industry' || key.includes('business') || key.includes('industry')) {
          formattedDiscoveryData['Business/Industry'] = trimmedValue;
          console.log(`✅ Direct mapping: Business/Industry = "${trimmedValue}"`);
        } else if (key === 'Main product' || key.includes('product')) {
          formattedDiscoveryData['Main product'] = trimmedValue;
          console.log(`✅ Direct mapping: Main product = "${trimmedValue}"`);
        } else if (key === 'Running ads' || key.includes('ads') || key.includes('advertising')) {
          formattedDiscoveryData['Running ads'] = trimmedValue;
          console.log(`✅ Direct mapping: Running ads = "${trimmedValue}"`);
        } else if (key === 'Using CRM' || key.includes('crm')) {
          formattedDiscoveryData['Using CRM'] = trimmedValue;
          console.log(`✅ Direct mapping: Using CRM = "${trimmedValue}"`);
        } else if (key === 'Pain points' || key.includes('pain') || key.includes('problem') || key.includes('challenge')) {
          formattedDiscoveryData['Pain points'] = trimmedValue;
          console.log(`✅ Direct mapping: Pain points = "${trimmedValue}"`);
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
      "How did you hear about us": formattedDiscoveryData["How did you hear about us"] || '',
      "Business/Industry": formattedDiscoveryData["Business/Industry"] || '',
      "Main product": formattedDiscoveryData["Main product"] || '',
      "Running ads": formattedDiscoveryData["Running ads"] || '',
      "Using CRM": formattedDiscoveryData["Using CRM"] || '',
      "Pain points": formattedDiscoveryData["Pain points"] || ''
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
        'question_0': 'How did you hear about us',
        'question_1': 'Business/Industry',
        'question_2': 'Main product',
        'question_3': 'Running ads',
        'question_4': 'Using CRM',
        'question_5': 'Pain points'
      };
      
      Object.entries(discoveryData).forEach(([key, value]) => {
        if (value && typeof value === 'string' && value.trim() !== '') {
          const trimmedValue = value.trim();
          if (key.startsWith('question_') && fieldMappings[key]) {
            formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          } else if (key === 'How did you hear about us' || key.includes('hear about')) {
            formattedDiscoveryData['How did you hear about us'] = trimmedValue;
          } else if (key === 'Business/Industry' || key.includes('business') || key.includes('industry')) {
            formattedDiscoveryData['Business/Industry'] = trimmedValue;
          } else if (key === 'Main product' || key.includes('product')) {
            formattedDiscoveryData['Main product'] = trimmedValue;
          } else if (key === 'Running ads' || key.includes('ads')) {
            formattedDiscoveryData['Running ads'] = trimmedValue;
          } else if (key === 'Using CRM' || key.includes('crm')) {
            formattedDiscoveryData['Using CRM'] = trimmedValue;
          } else if (key === 'Pain points' || key.includes('pain') || key.includes('problem')) {
            formattedDiscoveryData['Pain points'] = trimmedValue;
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
        "How did you hear about us": formattedDiscoveryData["How did you hear about us"] || '',
        "Business/Industry": formattedDiscoveryData["Business/Industry"] || '',
        "Main product": formattedDiscoveryData["Main product"] || '',
        "Running ads": formattedDiscoveryData["Running ads"] || '',
        "Using CRM": formattedDiscoveryData["Using CRM"] || '',
        "Pain points": formattedDiscoveryData["Pain points"] || ''
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

// ENHANCED: Better detection of discovery questions being asked
function trackDiscoveryQuestions(botMessage, discoveryProgress, discoveryQuestions) {
  if (!botMessage) return false;
  
  const botMessageLower = botMessage.toLowerCase();
  
  // Enhanced key phrases with more specific detection
  const keyPhrases = [
    ["hear about us", "find us", "discover us", "found us", "how did you hear"], // How did you hear about us
    ["business", "company", "industry", "what do you do", "line of business"], // What line of business are you in
    ["product", "service", "offer", "main product", "what's your main"], // What's your main product
    ["ads", "advertising", "marketing", "running ads", "ad campaigns"], // Are you running ads
    ["crm", "gohighlevel", "management system", "customer relationship"], // Are you using a CRM
    ["problems", "challenges", "issues", "pain points", "difficulties", "struggling with"] // What problems are you facing
  ];
  
  // Check each question's key phrases
  keyPhrases.forEach((phrases, index) => {
    if (phrases.some(phrase => botMessageLower.includes(phrase))) {
      discoveryProgress.questionsAsked.add(index);
      console.log(`✅ Detected question ${index} was asked: ${discoveryQuestions[index]}`);
    }
  });
  
  // Check for scheduling phrases
  const schedulingPhrases = ["schedule", "book a call", "day of the week", "what day works", "good time", "availability", "when would", "time work"];
  const hasSchedulingPhrase = schedulingPhrases.some(phrase => botMessageLower.includes(phrase));
  
  // Log the progress
  console.log(`📊 Question progress: ${discoveryProgress.questionsAsked.size}/${discoveryQuestions.length}, Scheduling phrase: ${hasSchedulingPhrase}`);
  console.log(`📋 Questions asked so far: [${Array.from(discoveryProgress.questionsAsked).join(', ')}]`);
  
  // Discovery is complete when we have at least 4 questions OR scheduling is mentioned
  const minimumQuestionsAsked = 4;
  const hasEnoughQuestions = discoveryProgress.questionsAsked.size >= minimumQuestionsAsked;
  const discoveryComplete = hasEnoughQuestions || hasSchedulingPhrase;
  
  if (discoveryComplete) {
    console.log('🎉 Discovery process considered complete!');
  }
  
  discoveryProgress.allQuestionsAsked = discoveryComplete;
  return discoveryComplete;
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

// ENHANCED WEBSOCKET CONNECTION HANDLER - EXTRACTS CALL ID, EMAIL, NAME
wss.on('connection', async (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION ESTABLISHED');
  console.log('Connection URL:', req.url);
  
  // Extract call ID from URL
  const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
  const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
  
  console.log('📞 Extracted Call ID:', callId);
  
  // Store connection data with this WebSocket
  const connectionData = {
    callId: callId, // ← FIXED: Set the call ID immediately
    metadata: null,
    customerEmail: null,
    customerName: null,
    customerPhone: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };

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
  
  // Define discovery questions as a trackable list - MODIFIED to match Airtable field names
  const discoveryQuestions = [
    'How did you hear about us?',
    'What industry or business are you in?',
    'What\'s your main product?',
    'Are you running ads right now?',
    'Are you using a CRM system?',
    'What pain points are you experiencing?'
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: 0,
    questionsAsked: new Set(),
    allQuestionsAsked: false
  };
  
  // UPDATED: Improved system prompt with better pacing and complete sentences
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella.

SPEAKING STYLE & PACING:
- Speak at a SLOW, measured pace - never rush your words
- Insert natural pauses between sentences using periods (.)
- Complete all your sentences fully - never cut off mid-thought
- Use shorter sentences rather than long, complex ones
- Add extra spaces between sentences to create natural pauses
- Never end a response abruptly - always finish your complete thought
- Keep your statements and questions concise but complete

PERSONALITY & TONE:
- Be warm and friendly but speak in a calm, measured way
- Use a consistent, even speaking tone throughout the conversation
- Use contractions and everyday language that sounds natural
- Only use exclamation points when truly appropriate
- Maintain a calm, professional demeanor at all times
- Never go up in tone or pitch at the end of sentences unless it is a question.
- Always keep and even consistent tonality unless it is a question.

KEY REMINDERS:
- We already have the customer's name and email from their form submission
- Address the customer by their actual name (NOT a placeholder name like Monica)
- DO NOT refer to the customer as Monica - use their actual name from metadata
- If you know the customer's name is Jaden, use "Jaden" throughout the conversation
- You don't need to ask for their email
- Ask one question at a time and pause for answers
- Acknowledge their answers before moving to the next question

IMPORTANT ABOUT DISCOVERY:
- You must ask all six discovery questions in order before scheduling
- Keep each question short and direct
- Add a brief pause after each question by ending with a period (.)
- Listen to their answers and respond accordingly, make a positive comment about their answer or compliment them confirming and validating their answer

DISCOVERY QUESTIONS (ask ALL of these IN ORDER):
1. "How did you hear about us?" (Maps to field: "How did you hear about us")
2. "What industry or business are you in?" (Maps to field: "Business/Industry")
3. "What's your main product?" (Maps to field: "Main product")
4. "Are you running ads right now?" (Maps to field: "Running ads")
5. "Are you using a CRM system?" (Maps to field: "Using CRM")
6. "What pain points are you experiencing?" (Maps to field: "Pain points")

SCHEDULING APPROACH:
- After asking ALL discovery questions, ask for what day works for a call
- Say: "Great. Let's schedule a call to discuss how we can help. What day would work best for you?"
- When they mention a day, acknowledge it calmly with a complete sentence
- Say: "Perfect. I'll send you a scheduling link for [day]. You can pick whatever time works best for you."
- Keep it simple and straightforward with clear pauses between sentences

NATURAL RESPONSES WITH PAUSES:
- If they say "Monday": "Monday works great. [pause] I'll send you a link for Monday. [pause] You can choose any time that's convenient for you."
- If they say "next week": "Next week works well. [pause] I'll send you a scheduling link. [pause] You can select any day that fits your schedule."
- If they're vague: "No problem. [pause] I'll send you our scheduling link. [pause] You can pick whatever day and time works best."

Remember: You MUST ask ALL SIX discovery questions before scheduling. Complete each sentence fully, speak slowly, and add natural pauses between thoughts. NEVER cut off your sentences abruptly. NEVER call the customer Monica - always use their actual name if available.`
    }
  ];

  // States for conversation flow
  let conversationState = 'introduction';  // introduction -> discovery -> booking -> completed
  let bookingInfo = {
    name: connectionData.customerName || '',
    email: connectionData.customerEmail || '',
    phone: connectionData.customerPhone || '',
    preferredDay: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let discoveryData = {}; // Store answers to discovery questions
  let collectedContactInfo = !!connectionData.customerEmail; // True if we have email
  let userHasSpoken = false;
  let webhookSent = false; // Track if we've sent the webhook

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
        content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 2000); // Reduced to 2 seconds for faster response

  // Set a timer for auto-greeting if user doesn't speak first
  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending backup auto-greeting');
      ws.send(JSON.stringify({
        content: "Hello! This is Sarah from Nexella AI. I'm here to help you today. How's everything going?",
        content_complete: true,
        actions: [],
        response_id: 2
      }));
    }
  }, 5000); // 5 seconds delay as backup

  ws.on('message', async (data) => {
    try {
      // Clear auto-greeting timer if user speaks first
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
                .replace(/\[Name\]/g, bookingInfo.name)
                .replace(/Monica/g, bookingInfo.name);
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
        console.log('📊 Current discovery data before processing:', JSON.stringify(discoveryData, null, 2));

        // ENHANCED: Capture discovery answers IMMEDIATELY when user responds
        if (conversationHistory.length >= 2) {
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          const secondLastMessage = conversationHistory[conversationHistory.length - 2];
          
          // Check the most recent bot message for discovery questions
          let questionDetected = false;
          let questionIndex = -1;
          
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            const botContent = lastBotMessage.content.toLowerCase();
            console.log(`🔍 Analyzing bot message: "${lastBotMessage.content}"`);
            
            // Enhanced question detection with more specific patterns
            const questionPatterns = [
              // Question 0: How did you hear about us?
              {
                keywords: ['hear about', 'find us', 'found us', 'discover us'],
                index: 0,
                field: 'How did you hear about us'
              },
              // Question 1: What business/industry?
              {
                keywords: ['industry', 'business', 'line of business', 'company', 'what do you do'],
                index: 1,
                field: 'Business/Industry'
              },
              // Question 2: Main product?
              {
                keywords: ['main product', 'product', 'service', 'sell', 'offer', 'price point'],
                index: 2,
                field: 'Main product'
              },
              // Question 3: Running ads?
              {
                keywords: ['ads', 'advertising', 'marketing', 'running ads', 'meta', 'google'],
                index: 3,
                field: 'Running ads'
              },
              // Question 4: Using CRM?
              {
                keywords: ['crm', 'gohighlevel', 'management system', 'customer relationship'],
                index: 4,
                field: 'Using CRM'
              },
              // Question 5: Pain points?
              {
                keywords: ['pain points', 'problems', 'challenges', 'issues', 'difficulties', 'struggling', 'biggest challenge'],
                index: 5,
                field: 'Pain points'
              }
            ];
            
            // Check each pattern
            questionPatterns.forEach(pattern => {
              if (pattern.keywords.some(keyword => botContent.includes(keyword))) {
                questionDetected = true;
                questionIndex = pattern.index;
                
                // IMMEDIATELY store the user's response
                discoveryData[`question_${pattern.index}`] = userMessage.trim();
                discoveryData[pattern.field] = userMessage.trim();
                
                console.log(`✅ CAPTURED ANSWER TO QUESTION ${pattern.index}:`);
                console.log(`   Question: ${discoveryQuestions[pattern.index]}`);
                console.log(`   Answer: "${userMessage.trim()}"`);
                console.log(`   Field: ${pattern.field}`);
                
                // Mark question as asked
                discoveryProgress.questionsAsked.add(pattern.index);
              }
            });
          }
          
          // Also check if the second-to-last message was a question (in case of rapid responses)
          if (!questionDetected && secondLastMessage && secondLastMessage.role === 'assistant') {
            const botContent = secondLastMessage.content.toLowerCase();
            console.log(`🔍 Also checking previous bot message: "${secondLastMessage.content}"`);
            
            const questionPatterns = [
              {keywords: ['hear about', 'find us', 'found us'], index: 0, field: 'How did you hear about us'},
              {keywords: ['industry', 'business', 'line of business'], index: 1, field: 'Business/Industry'},
              {keywords: ['main product', 'product', 'service'], index: 2, field: 'Main product'},
              {keywords: ['ads', 'advertising', 'marketing'], index: 3, field: 'Running ads'},
              {keywords: ['crm', 'management system'], index: 4, field: 'Using CRM'},
              {keywords: ['pain points', 'problems', 'challenges'], index: 5, field: 'Pain points'}
            ];
            
            questionPatterns.forEach(pattern => {
              if (pattern.keywords.some(keyword => botContent.includes(keyword))) {
                discoveryData[`question_${pattern.index}`] = userMessage.trim();
                discoveryData[pattern.field] = userMessage.trim();
                discoveryProgress.questionsAsked.add(pattern.index);
                console.log(`✅ CAPTURED DELAYED ANSWER TO QUESTION ${pattern.index}: "${userMessage.trim()}"`);
              }
            });
          }
        }
        
        // Log current state after capture attempt
        console.log('📊 Discovery data after capture attempt:', JSON.stringify(discoveryData, null, 2));
        console.log('📊 Questions asked so far:', Array.from(discoveryProgress.questionsAsked));
        console.log('📊 Total questions captured:', Object.keys(discoveryData).length);

        // Check for scheduling preference
        if (userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/)) {
          console.log('🗓️ User mentioned scheduling');
          
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo && !webhookSent) {
            bookingInfo.preferredDay = dayInfo.dayName;
            console.log('🗓️ Detected preferred day:', bookingInfo.preferredDay);
            
            // IMMEDIATE webhook send when scheduling detected
            console.log('🚀 IMMEDIATE WEBHOOK SEND - Scheduling detected');
            console.log('📋 Final discovery data being sent:', JSON.stringify(discoveryData, null, 2));
            
            const result = await sendSchedulingPreference(
              bookingInfo.name || connectionData.customerName || '',
              bookingInfo.email || connectionData.customerEmail || '',
              bookingInfo.phone || connectionData.customerPhone || '',
              bookingInfo.preferredDay,
              connectionData.callId,
              discoveryData
            );
            
            if (result.success) {
              webhookSent = true;
              conversationState = 'completed';
              console.log('✅ Webhook sent successfully on scheduling detection');
            }
          }
        }

        // Add user message to conversation history
        conversationHistory.push({ role: 'user', content: userMessage });

        // Process with GPT
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: conversationHistory,
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

        // Add bot reply to conversation history
        conversationHistory.push({ role: 'assistant', content: botReply });

        // Enhanced discovery tracking based on bot reply
        const discoveryComplete = trackDiscoveryQuestions(botReply, discoveryProgress, discoveryQuestions);
        
        // Update conversation state
        if (conversationState === 'introduction') {
          conversationState = 'discovery';
        } else if (conversationState === 'discovery' && discoveryComplete) {
          conversationState = 'booking';
          console.log('🔄 Transitioning to booking state');
        }

        // Send the AI response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
        // ENHANCED: Send webhook immediately if we have sufficient discovery data
        if (!webhookSent && Object.keys(discoveryData).length >= 3 && 
            (bookingInfo.email || connectionData.customerEmail)) {
          
          // Check if we have at least 3 meaningful answers
          const meaningfulAnswers = Object.values(discoveryData).filter(answer => 
            answer && typeof answer === 'string' && answer.trim().length > 2
          ).length;
          
          if (meaningfulAnswers >= 3) {
            console.log('🚀 PROACTIVE WEBHOOK SEND - Sufficient discovery data collected');
            console.log('📋 Sending discovery data:', JSON.stringify(discoveryData, null, 2));
            
            await sendSchedulingPreference(
              bookingInfo.name || connectionData.customerName || '',
              bookingInfo.email || connectionData.customerEmail || '',
              bookingInfo.phone || connectionData.customerPhone || '',
              bookingInfo.preferredDay || 'Continuing conversation',
              connectionData.callId,
              discoveryData
            );
            
            webhookSent = true;
            console.log('✅ Proactive webhook sent successfully');
          }
        }
        
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      
      // Emergency webhook send with whatever data we have
      if (!webhookSent && connectionData.callId && 
          (bookingInfo.email || connectionData.customerEmail)) {
        try {
          console.log('🚨 EMERGENCY WEBHOOK SEND due to error');
          await sendSchedulingPreference(
            bookingInfo.name || connectionData.customerName || '',
            bookingInfo.email || connectionData.customerEmail || '',
            bookingInfo.phone || connectionData.customerPhone || '',
            bookingInfo.preferredDay || 'Error occurred',
            connectionData.callId,
            discoveryData
          );
          webhookSent = true;
          console.log('✅ Emergency webhook sent');
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
    
    console.log('=== FINAL CONNECTION CLOSE ANALYSIS ===');
    console.log('📋 Final discoveryData:', JSON.stringify(discoveryData, null, 2));
    console.log('📊 Total answers captured:', Object.keys(discoveryData).length);
    console.log('👤 Customer info:', {
      email: connectionData.customerEmail || bookingInfo.email,
      name: connectionData.customerName || bookingInfo.name,
      phone: connectionData.customerPhone || bookingInfo.phone
    });
    console.log('📞 Call ID:', connectionData.callId);
    console.log('📧 Webhook sent:', webhookSent);
    
    // ALWAYS attempt to send webhook on close if we haven't sent it yet
    if (!webhookSent && connectionData.callId) {
      try {
        // Get final customer info
        const finalEmail = connectionData.customerEmail || bookingInfo.email || '';
        const finalName = connectionData.customerName || bookingInfo.name || '';
        const finalPhone = connectionData.customerPhone || bookingInfo.phone || '';
        
        console.log('🚨 FINAL WEBHOOK ATTEMPT on connection close');
        console.log('📋 Sending final discovery data:', JSON.stringify(discoveryData, null, 2));
        
        await sendSchedulingPreference(
          finalName,
          finalEmail,
          finalPhone,
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          discoveryData
        );
        
        console.log('✅ Final webhook sent successfully on connection close');
        webhookSent = true;
      } catch (finalError) {
        console.error('❌ Final webhook failed:', finalError.message);
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
          'How did you hear about us?',
          'What industry or business are you in?',
          'What\'s your main product?',
          'Are you running ads right now?',
          'Are you using a CRM system?',
          'What pain points are you experiencing?'
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
