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

// FIXED: Send scheduling data with CORRECT field mapping
async function sendSchedulingPreference(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    console.log('=== WEBHOOK SENDING DEBUG ===');
    console.log('Input parameters:', { name, email, phone, preferredDay, callId });
    console.log('Raw discovery data input:', JSON.stringify(discoveryData, null, 2));
    
    // Try multiple methods to get email
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
    
    // Don't proceed if we still don't have an email
    if (!finalEmail || finalEmail.trim() === '') {
      console.error('❌ CRITICAL: No email found from any source. Cannot send webhook.');
      return { success: false, error: 'No email address available' };
    }
    
    // FIXED: Correct field mapping to match your Airtable structure
    const formattedDiscoveryData = {};
    
    // CORRECT field mappings - based on your logs showing the right field names
    const fieldMappings = {
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry',
      'question_2': 'Main product',
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
    };
    
    // Process discovery data with correct mapping
    Object.entries(discoveryData).forEach(([key, value]) => {
      console.log(`🔧 Processing key: "${key}" with value: "${value}"`);
      
      if (value && typeof value === 'string' && value.trim() !== '') {
        const trimmedValue = value.trim();
        
        if (key.startsWith('question_') && fieldMappings[key]) {
          formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          console.log(`✅ Mapped ${key} -> "${fieldMappings[key]}" = "${trimmedValue}"`);
        } else if (fieldMappings[key]) {
          formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          console.log(`✅ Direct mapping: ${fieldMappings[key]} = "${trimmedValue}"`);
        } else {
          // Keep original key if it doesn't match any pattern
          formattedDiscoveryData[key] = trimmedValue;
          console.log(`📝 Keeping original key: ${key} = "${trimmedValue}"`);
        }
      }
    });
    
    console.log('🔧 FINAL FORMATTED DISCOVERY DATA:', JSON.stringify(formattedDiscoveryData, null, 2));
    
    // Ensure phone number is formatted properly
    if (finalPhone && !finalPhone.startsWith('+')) {
      finalPhone = '+1' + finalPhone.replace(/[^0-9]/g, '');
    }
    
    // Create the webhook payload
    const webhookData = {
      name: finalName || '',
      email: finalEmail,
      phone: finalPhone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData,
      formatted_discovery: formattedDiscoveryData,
      // Include individual fields for direct access
      "How did you hear about us": formattedDiscoveryData["How did you hear about us"] || '',
      "Business/Industry": formattedDiscoveryData["Business/Industry"] || '',
      "Main product": formattedDiscoveryData["Main product"] || '',
      "Running ads": formattedDiscoveryData["Running ads"] || '',
      "Using CRM": formattedDiscoveryData["Using CRM"] || '',
      "Pain points": formattedDiscoveryData["Pain points"] || ''
    };
    
    console.log('📤 COMPLETE WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Scheduling preference sent successfully:', response.data);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error('❌ Error sending scheduling preference:', error);
    
    // Enhanced fallback to n8n
    try {
      console.log('🔄 Attempting fallback to n8n webhook');
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
      
      const fallbackWebhookData = {
        name: finalName || '',
        email: finalEmail || '',
        phone: finalPhone || '',
        preferredDay: preferredDay || '',
        call_id: callId || '',
        schedulingComplete: true,
        "How did you hear about us": discoveryData["How did you hear about us"] || discoveryData["question_0"] || '',
        "Business/Industry": discoveryData["Business/Industry"] || discoveryData["question_1"] || '',
        "Main product": discoveryData["Main product"] || discoveryData["question_2"] || '',
        "Running ads": discoveryData["Running ads"] || discoveryData["question_3"] || '',
        "Using CRM": discoveryData["Using CRM"] || discoveryData["question_4"] || '',
        "Pain points": discoveryData["Pain points"] || discoveryData["question_5"] || ''
      };
      
      const n8nResponse = await axios.post(n8nWebhookUrl, fallbackWebhookData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      console.log('✅ Successfully sent to n8n fallback:', n8nResponse.data);
      return { success: true, fallback: true };
      
    } catch (n8nError) {
      console.error('❌ Error sending to n8n fallback:', n8nError);
      return { success: false, error: error.message };
    }
  }
}

// Better detection of scheduling preferences
function handleSchedulingPreference(userMessage) {
  const dayMatch = userMessage.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today/i);
  const nextWeekMatch = userMessage.match(/next week/i);
  
  if (nextWeekMatch) {
    let targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 7);
    
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
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const requestedDayIndex = daysOfWeek.findIndex(d => d === preferredDay);
      
      if (requestedDayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = requestedDayIndex - currentDay;
        
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
app.post('/trigger-retell-call', express.json(), async (req, res) => {
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
        agent_id: process.env.RETELL_AGENT_ID,
        customer_number: phone,
        variables: initialVariables,
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

// WebSocket connection handler - FIXED question mapping
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

  // Try to fetch call metadata but don't block if it fails
  if (callId) {
    try {
      console.log('🔍 Fetching metadata for call:', callId);
      const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
      
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
            
            const actualData = callData.data || callData;
            connectionData.metadata = actualData;
            
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
  
  // FIXED: Discovery questions system with correct indexing
  const discoveryQuestions = [
    {
      question: 'How did you hear about us?',
      field: 'How did you hear about us',
      keywords: ['hear about', 'find us', 'found us', 'discover us', 'learn about', 'how did you hear'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'What industry or business are you in?',
      field: 'Business/Industry',
      keywords: ['industry', 'business', 'line of business', 'company', 'what do you do', 'work in'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'What\'s your main product or service?',
      field: 'Main product',
      keywords: ['main product', 'product', 'service', 'sell', 'offer', 'provide'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'Are you currently running any ads?',
      field: 'Running ads',
      keywords: ['ads', 'advertising', 'marketing', 'running ads', 'meta', 'google', 'facebook'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'Are you using any CRM system?',
      field: 'Using CRM',
      keywords: ['crm', 'gohighlevel', 'management system', 'customer relationship', 'software'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'What are your biggest pain points or challenges?',
      field: 'Pain points',
      keywords: ['pain points', 'problems', 'challenges', 'issues', 'difficulties', 'struggling', 'biggest challenge', 'pain point'],
      asked: false,
      answered: false,
      answer: ''
    }
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: 0,
    questionsCompleted: 0,
    allQuestionsCompleted: false,
    lastBotMessage: '',
    waitingForAnswer: false,
    questionOrder: []
  };

  // System prompt
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella.

CONVERSATION FLOW:
1. GREETING PHASE: Start with a warm greeting and ask how they're doing
2. BRIEF CHAT: Engage in 1-2 exchanges of pleasantries before discovery
3. TRANSITION: Naturally transition to discovery questions
4. DISCOVERY PHASE: Ask all 6 discovery questions systematically
5. SCHEDULING PHASE: Only after all 6 questions are complete

GREETING & TRANSITION GUIDELINES:
- Always start with: "Hi there! This is Sarah from Nexella AI. How are you doing today?"
- When they respond to how they're doing, acknowledge it warmly
- After 1-2 friendly exchanges, transition naturally with something like:
  "That's great to hear! I'd love to learn a bit more about you and your business so I can better help you today."
- Then start with the first discovery question

CRITICAL DISCOVERY REQUIREMENTS:
- You MUST ask ALL 6 discovery questions in the exact order listed below
- Ask ONE question at a time and wait for the customer's response
- Do NOT move to scheduling until ALL 6 questions are answered
- After each answer, acknowledge it briefly before asking the next question

DISCOVERY QUESTIONS (ask in this EXACT order):
1. "How did you hear about us?"
2. "What industry or business are you in?"
3. "What's your main product or service?"
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

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
- After each answer, say something like "That's great, thank you for sharing that."
- Then immediately ask the next question
- Do NOT skip questions or assume answers
- Count your questions mentally: 1, 2, 3, 4, 5, 6

SCHEDULING APPROACH:
- ONLY after asking ALL 6 discovery questions, ask for scheduling preference
- Say: "Perfect! I have all the information I need. Let's schedule a call to discuss how we can help. What day would work best for you?"
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
  let discoveryData = {};
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
        content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 2000);

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
  }, 5000);

  // ENHANCED: Message handling with FIXED discovery tracking
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
      
      // Get contact info when we connect to a call (BACKUP METHOD)
      if (parsed.call && parsed.call.call_id && !collectedContactInfo) {
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
        console.log('📊 Discovery progress:', discoveryProgress);

        // FIXED: Better discovery question tracking with CORRECT indexing
        if (conversationHistory.length >= 2) {
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            const botContent = lastBotMessage.content.toLowerCase();
            discoveryProgress.lastBotMessage = botContent;
            
            // Check if bot asked ANY discovery question that hasn't been asked yet
            discoveryQuestions.forEach((q, index) => {
              if (!q.asked) {
                let keywordMatch = false;
                
                // Enhanced keyword matching for each specific question
                if (index === 0) { // How did you hear about us
                  keywordMatch = botContent.includes('how did you hear') || 
                                botContent.includes('hear about') ||
                                botContent.includes('find us') ||
                                botContent.includes('found us') ||
                                botContent.includes('discover us');
                } else if (index === 1) { // Business/Industry
                  keywordMatch = botContent.includes('industry') || 
                                botContent.includes('business') ||
                                botContent.includes('what do you do') ||
                                botContent.includes('line of business') ||
                                botContent.includes('work in');
                } else if (index === 2) { // Main product
                  keywordMatch = botContent.includes('main product') || 
                                botContent.includes('product') || 
                                botContent.includes('service') ||
                                botContent.includes('what do you sell') ||
                                botContent.includes('what do you offer');
                } else if (index === 3) { // Running ads
                  keywordMatch = botContent.includes('running ads') || 
                                botContent.includes('ads') || 
                                botContent.includes('advertising') ||
                                botContent.includes('marketing') ||
                                botContent.includes('facebook') ||
                                botContent.includes('google') ||
                                botContent.includes('meta');
                } else if (index === 4) { // Using CRM
                  keywordMatch = botContent.includes('crm') || 
                                botContent.includes('customer relationship') ||
                                botContent.includes('management system') ||
                                botContent.includes('using any') ||
                                botContent.includes('software') ||
                                botContent.includes('gohighlevel');
                } else if (index === 5) { // Pain points
                  keywordMatch = botContent.includes('pain point') || 
                                botContent.includes('challenge') || 
                                botContent.includes('problem') || 
                                botContent.includes('difficult') ||
                                botContent.includes('struggle') ||
                                botContent.includes('biggest') ||
                                botContent.includes('issue');
                }
                
                if (keywordMatch) {
                  console.log(`✅ DETECTED: Question ${index} (${q.field}) was asked: "${q.question}"`);
                  q.asked = true;
                  discoveryProgress.waitingForAnswer = true;
                  discoveryProgress.currentQuestionIndex = index; // This will be 0, 1, 2, 3, 4, or 5
                  discoveryProgress.questionOrder.push(index);
                }
              }
            });
            
            // If we were waiting for an answer and user responded, capture it with CORRECT indexing
            if (discoveryProgress.waitingForAnswer && userMessage.trim().length > 2) {
              const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
              if (currentQ && currentQ.asked && !currentQ.answered) {
                // Enhanced answer validation - check for greeting responses that shouldn't be captured
                let userAnswer = userMessage.trim();
                
                // Special handling for greeting responses on question 0
                if (discoveryProgress.currentQuestionIndex === 0) {
                  const msg = userMessage.toLowerCase();
                  if (msg.includes('good') || msg.includes('fine') || msg.includes('how are you') || 
                      msg.includes('great') || msg.includes('doing well') || msg.includes('i\'m doing') || 
                      msg === 'hello' || msg === 'hi' || msg === 'hey') {
                    console.log('⚠️ Skipping greeting response as discovery answer');
                    discoveryProgress.waitingForAnswer = false;
                    return;
                  }
                }
                
                currentQ.answered = true;
                currentQ.answer = userAnswer;
                
                // CORRECT mapping - use the actual index from the array
                discoveryData[currentQ.field] = userAnswer;
                discoveryData[`question_${discoveryProgress.currentQuestionIndex}`] = userAnswer;
                
                discoveryProgress.questionsCompleted++;
                discoveryProgress.waitingForAnswer = false;
                
                console.log(`✅ CAPTURED ANSWER ${discoveryProgress.questionsCompleted}/6:`);
                console.log(`   Question Index: ${discoveryProgress.currentQuestionIndex}`);
                console.log(`   Question: ${currentQ.question}`);
                console.log(`   Answer: "${userAnswer}"`);
                console.log(`   Field: ${currentQ.field}`);
                console.log(`   Question Key: question_${discoveryProgress.currentQuestionIndex}`);
                
                // Debug: Show current discovery data
                console.log('📋 Current discovery data:', JSON.stringify(discoveryData, null, 2));
                
                // Debug: Show which questions are still unanswered
                const unanswered = discoveryQuestions.filter(q => !q.answered);
                console.log(`📋 Remaining questions: ${unanswered.length}`);
                unanswered.forEach((q, i) => {
                  const originalIndex = discoveryQuestions.indexOf(q);
                  console.log(`   ${originalIndex}. ${q.question} (asked: ${q.asked})`);
                });
              }
            }
          }
        }

        // More accurate completion check
        discoveryProgress.allQuestionsCompleted = discoveryQuestions.every(q => q.answered);
        
        console.log(`📊 Discovery Status: ${discoveryProgress.questionsCompleted}/6 questions completed`);
        console.log(`📊 All questions completed: ${discoveryProgress.allQuestionsCompleted}`);

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

        // Better context for GPT about current question status
        let contextPrompt = '';
        if (!discoveryProgress.allQuestionsCompleted) {
          const nextUnanswered = discoveryQuestions.find(q => !q.answered);
          if (nextUnanswered) {
            const questionNumber = discoveryQuestions.indexOf(nextUnanswered) + 1;
            contextPrompt = `\n\nIMPORTANT: You need to ask question ${questionNumber}: "${nextUnanswered.question}". You have completed ${discoveryProgress.questionsCompleted} out of 6 questions so far. Do NOT skip to scheduling until all 6 questions are answered.`;
          }
        } else {
          contextPrompt = '\n\nAll 6 discovery questions have been completed. You can now proceed to scheduling.';
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
        
        // Enhanced webhook sending logic
        if (schedulingDetected && discoveryProgress.allQuestionsCompleted && !webhookSent) {
          console.log('🚀 SENDING WEBHOOK - All conditions met:');
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
      
      // Enhanced emergency webhook logic
      if (!webhookSent && connectionData.callId && 
          (bookingInfo.email || connectionData.customerEmail) &&
          discoveryProgress.questionsCompleted >= 4) {
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
            bookingInfo.preferredDay || 'Error occurred',
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
    
    console.log('=== FINAL CONNECTION CLOSE ANALYSIS ===');
    console.log('📋 Final discoveryData:', JSON.stringify(discoveryData, null, 2));
    console.log('📊 Questions completed:', discoveryProgress.questionsCompleted);
    console.log('📊 All questions completed:', discoveryProgress.allQuestionsCompleted);
    
    // Detailed breakdown of each question
    discoveryQuestions.forEach((q, index) => {
      console.log(`Question ${index}: Asked=${q.asked}, Answered=${q.answered}, Answer="${q.answer}"`);
    });
    
    // FINAL webhook attempt only if we have meaningful data and haven't sent yet
    if (!webhookSent && connectionData.callId && discoveryProgress.questionsCompleted >= 2) {
      try {
        const finalEmail = connectionData.customerEmail || bookingInfo.email || '';
        const finalName = connectionData.customerName || bookingInfo.name || '';
        const finalPhone = connectionData.customerPhone || bookingInfo.phone || '';
        
        console.log('🚨 FINAL WEBHOOK ATTEMPT on connection close');
        console.log(`📊 Sending with ${discoveryProgress.questionsCompleted}/6 questions completed`);
        
        // Create final discovery data from answered questions
        const finalDiscoveryData = {};
        discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
        await sendSchedulingPreference(
          finalName,
          finalEmail,
          finalPhone,
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          finalDiscoveryData
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
