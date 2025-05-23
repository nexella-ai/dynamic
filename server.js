require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

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
    console.log('=== WEBHOOK SENDING DEBUG ===');
    console.log('Input parameters:', { name, email, phone, preferredDay, callId });
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
    
    // Enhanced name retrieval
    if (!finalName || finalName.trim() === '') {
      if (global.lastTypeformSubmission && global.lastTypeformSubmission.name) {
        finalName = global.lastTypeformSubmission.name;
        console.log(`Using name from global Typeform: ${finalName}`);
      } else if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        if (callMetadata && callMetadata.customer_name) {
          finalName = callMetadata.customer_name;
          console.log(`Using name from call metadata: ${finalName}`);
        }
      }
    }
    
    // Enhanced phone retrieval
    if (!finalPhone || finalPhone.trim() === '') {
      if (global.lastTypeformSubmission && global.lastTypeformSubmission.phone) {
        finalPhone = global.lastTypeformSubmission.phone;
        console.log(`Using phone from global Typeform: ${finalPhone}`);
      } else if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        if (callMetadata && (callMetadata.phone || callMetadata.to_number)) {
          finalPhone = callMetadata.phone || callMetadata.to_number;
          console.log(`Using phone from call metadata: ${finalPhone}`);
        }
      }
    }
    
    // Log what we're going to use
    console.log(`Final contact info - Email: "${finalEmail}", Name: "${finalName}", Phone: "${finalPhone}"`);
    
    // CRITICAL: Don't proceed if we still don't have an email
    if (!finalEmail || finalEmail.trim() === '') {
      console.error('❌ CRITICAL: No email found from any source. Cannot send webhook.');
      return { success: false, error: 'No email address available' };
    }
    
    // Format discovery data to exactly match Airtable field names
    const formattedDiscoveryData = {};
    
    // Map the discovery questions to the EXACT Airtable field names
    const fieldMappings = {
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry',
      'question_2': 'Main product',
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
    };
    
    // Process all discovery data with exact field names
    Object.entries(discoveryData).forEach(([key, value]) => {
      if (key.startsWith('question_')) {
        // Map question_X to the exact Airtable field name
        if (fieldMappings[key]) {
          formattedDiscoveryData[fieldMappings[key]] = value;
        } else {
          // Fallback if question key not found
          formattedDiscoveryData[key] = value;
        }
      } else if (key.includes('hear about us')) {
        formattedDiscoveryData['How did you hear about us'] = value;
      } else if (key.includes('business') || key.includes('industry')) {
        formattedDiscoveryData['Business/Industry'] = value;
      } else if (key.includes('product')) {
        formattedDiscoveryData['Main product'] = value;
      } else if (key.includes('ads') || key.includes('advertising')) {
        formattedDiscoveryData['Running ads'] = value;
      } else if (key.includes('crm')) {
        formattedDiscoveryData['Using CRM'] = value;
      } else if (key.includes('pain') || key.includes('problem') || key.includes('points')) {
        formattedDiscoveryData['Pain points'] = value;
      } else {
        // Keep original keys for anything not matched
        formattedDiscoveryData[key] = value;
      }
    });
    
    // Add pain point from the last question if it's available but not yet mapped
    // This ensures we always capture the pain points question answer
    if (discoveryData['question_5'] && !formattedDiscoveryData['Pain points']) {
      formattedDiscoveryData['Pain points'] = discoveryData['question_5'];
      console.log('Added pain points from question_5:', discoveryData['question_5']);
    }
    
    // Ensure phone number is formatted properly with leading +
    if (finalPhone && !finalPhone.startsWith('+')) {
      finalPhone = '+1' + finalPhone.replace(/[^0-9]/g, '');
    }
    
    // Make the webhook data with GUARANTEED email
    const webhookData = {
      name: finalName || '',
      email: finalEmail, // This is now guaranteed to have a value
      phone: finalPhone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData
    };
    
    // Log the data we're about to send
    console.log('✅ Sending scheduling preference to trigger server:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Scheduling preference sent successfully:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ Error sending scheduling preference:', error);
    
    // Enhanced fallback to n8n
    try {
      console.log('🔄 Attempting to send directly to n8n webhook as fallback');
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
      console.log(`Using n8n webhook URL: ${n8nWebhookUrl}`);
      
      // Use the same enhanced email logic for fallback
      let fallbackEmail = email;
      let fallbackName = name;
      let fallbackPhone = phone;
      
      if (!fallbackEmail && global.lastTypeformSubmission) {
        fallbackEmail = global.lastTypeformSubmission.email;
        fallbackName = fallbackName || global.lastTypeformSubmission.name;
        fallbackPhone = fallbackPhone || global.lastTypeformSubmission.phone;
      }
      
      if (!fallbackEmail && callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        fallbackEmail = fallbackEmail || callMetadata?.customer_email;
        fallbackName = fallbackName || callMetadata?.customer_name;
        fallbackPhone = fallbackPhone || callMetadata?.phone || callMetadata?.to_number;
      }
      
      // Format discovery data again for n8n
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
        if (key.startsWith('question_')) {
          if (fieldMappings[key]) {
            formattedDiscoveryData[fieldMappings[key]] = value;
          } else {
            formattedDiscoveryData[key] = value;
          }
        } else if (key.includes('hear about us')) {
          formattedDiscoveryData['How did you hear about us'] = value;
        } else if (key.includes('business') || key.includes('industry')) {
          formattedDiscoveryData['Business/Industry'] = value;
        } else if (key.includes('product')) {
          formattedDiscoveryData['Main product'] = value;
        } else if (key.includes('ads') || key.includes('advertising')) {
          formattedDiscoveryData['Running ads'] = value;
        } else if (key.includes('crm')) {
          formattedDiscoveryData['Using CRM'] = value;
        } else if (key.includes('pain') || key.includes('problem') || key.includes('points')) {
          formattedDiscoveryData['Pain points'] = value;
        } else {
          formattedDiscoveryData[key] = value;
        }
      });
      
      if (discoveryData['question_5'] && !formattedDiscoveryData['Pain points']) {
        formattedDiscoveryData['Pain points'] = discoveryData['question_5'];
      }
      
      const fallbackWebhookData = {
        name: fallbackName || '',
        email: fallbackEmail || '', // Send whatever we found
        phone: fallbackPhone || '',
        preferredDay: preferredDay || '',
        call_id: callId || '',
        schedulingComplete: true,
        discovery_data: formattedDiscoveryData
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

// IMPROVED: Better detection of discovery questions being asked and answered
function trackDiscoveryQuestions(botMessage, discoveryProgress, discoveryQuestions) {
  if (!botMessage) return false;
  
  const botMessageLower = botMessage.toLowerCase();
  
  // Key phrases to detect in the bot's message that indicate specific discovery questions
  const keyPhrases = [
    ["hear about us", "find us", "discover us", "found us", "discovered nexella"], // How did you hear about us
    ["business", "company", "industry", "what do you do", "line of business", "business model"], // What line of business are you in
    ["product", "service", "offer", "price point", "main product", "typical price"], // What's your main product
    ["ads", "advertising", "marketing", "meta", "google", "tiktok", "running ads"], // Are you running ads
    ["crm", "gohighlevel", "management system", "customer relationship", "using any crm"], // Are you using a CRM
    ["problems", "challenges", "issues", "pain points", "difficulties", "running into", "what problems"] // What problems are you facing
  ];
  
  // Check each question's key phrases
  keyPhrases.forEach((phrases, index) => {
    if (phrases.some(phrase => botMessageLower.includes(phrase))) {
      discoveryProgress.questionsAsked.add(index);
      console.log(`Detected question ${index} was asked: ${discoveryQuestions[index]}`);
    }
  });
  
  // Only consider discovery complete if we have asked at least 5 questions AND 
  // there's a scheduling-related phrase OR all 6 questions have been asked
  const minimumQuestionsAsked = 5;
  const schedulingPhrases = ["schedule", "book a call", "day of the week", "what day works", "good time", "availability"];
  
  const hasSchedulingPhrase = schedulingPhrases.some(phrase => botMessageLower.includes(phrase));
  const hasEnoughQuestions = discoveryProgress.questionsAsked.size >= minimumQuestionsAsked;
  const hasAllQuestions = discoveryProgress.questionsAsked.size >= discoveryQuestions.length;
  
  // Log the progress for debugging
  console.log(`Question progress: ${discoveryProgress.questionsAsked.size}/${discoveryQuestions.length}, Scheduling phrase: ${hasSchedulingPhrase}`);
  
  // Consider discovery complete when we have enough questions OR all questions
  const discoveryComplete = (hasEnoughQuestions && hasSchedulingPhrase) || hasAllQuestions;
  
  if (discoveryComplete) {
    console.log('Discovery process considered complete!');
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

// FIXED: Enhanced WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');
  
  // Store connection data with this WebSocket
  const connectionData = {
    callId: null,
    metadata: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };
  
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
    name: '',
    email: '',
    phone: '',
    preferredDay: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let discoveryData = {}; // Store answers to discovery questions
  let collectedContactInfo = false;
  let userHasSpoken = false;
  let webhookSent = false; // Track if we've sent the webhook

  // Send connecting message
  ws.send(JSON.stringify({
    content: "connecting...",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  // Set a timer for auto-greeting if user doesn't speak first
  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      ws.send(JSON.stringify({
        content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 5000); // 5 seconds delay

  ws.on('message', async (data) => {
    try {
      // Clear auto-greeting timer if user speaks first
      clearTimeout(autoGreetingTimer);
      userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      
      // Debug logging to see what we're receiving
      console.log('WebSocket message type:', parsed.interaction_type || 'unknown');
      if (parsed.call) {
        console.log('Call data structure:', JSON.stringify(parsed.call, null, 2));
      }
      
      // FIXED: Enhanced contact info extraction when we connect to a call
      if (parsed.call && parsed.call.call_id && !connectionData.callId) {
        connectionData.callId = parsed.call.call_id;
        console.log(`🔗 Connected to call: ${connectionData.callId}`);
        
        // PRIORITY 1: Extract from call metadata immediately
        if (parsed.call.metadata) {
          connectionData.metadata = parsed.call.metadata;
          console.log('📞 Call metadata received:', JSON.stringify(connectionData.metadata, null, 2));
          
          // Extract contact info from metadata
          if (connectionData.metadata.customer_name) {
            bookingInfo.name = connectionData.metadata.customer_name;
            console.log(`✅ Got name from metadata: ${bookingInfo.name}`);
          }
          
          if (connectionData.metadata.customer_email) {
            bookingInfo.email = connectionData.metadata.customer_email;
            console.log(`✅ Got email from metadata: ${bookingInfo.email}`);
            collectedContactInfo = true;
          }
          
          if (connectionData.metadata.user_id && connectionData.metadata.user_id.includes('+')) {
            // Extract phone from user_id if it contains a phone number
            bookingInfo.phone = connectionData.metadata.user_id.replace('user_', '');
            console.log(`✅ Got phone from user_id: ${bookingInfo.phone}`);
          } else if (parsed.call.to_number) {
            bookingInfo.phone = parsed.call.to_number;
            console.log(`✅ Got phone from to_number: ${bookingInfo.phone}`);
          }
          
          // Store this in global variable for sendSchedulingPreference function
          storeContactInfoGlobally(bookingInfo.name, bookingInfo.email, bookingInfo.phone, 'Call Metadata');
        } else {
          console.log('⚠️ No metadata in call object');
        }
        
        // PRIORITY 2: Try to get contact info from trigger server using call_id (as backup)
        if (!bookingInfo.email) {
          try {
            console.log('📞 Attempting to fetch contact info from trigger server...');
            const triggerResponse = await axios.get(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/get-call-info/${connectionData.callId}`, {
              timeout: 5000
            });
            
            if (triggerResponse.data && triggerResponse.data.success) {
              const callInfo = triggerResponse.data.data;
              
              if (callInfo.email && !bookingInfo.email) {
                bookingInfo.email = callInfo.email;
                console.log('✅ Got email from trigger server:', bookingInfo.email);
                collectedContactInfo = true;
              }
              
              if (callInfo.name && !bookingInfo.name) {
                bookingInfo.name = callInfo.name;
                console.log('✅ Got name from trigger server:', bookingInfo.name);
              }
              
              if (callInfo.phone && !bookingInfo.phone) {
                bookingInfo.phone = callInfo.phone;
                console.log('✅ Got phone from trigger server:', bookingInfo.phone);
              }
              
              // Store this globally as well
              storeContactInfoGlobally(bookingInfo.name, bookingInfo.email, bookingInfo.phone, 'Trigger Server');
            }
          } catch (triggerError) {
            console.log('⚠️ Could not fetch contact info from trigger server:', triggerError.message);
          }
        }
        
        // Store in active calls metadata map for the sendSchedulingPreference function
        activeCallsMetadata.set(connectionData.callId, {
          customer_email: bookingInfo.email,
          customer_name: bookingInfo.name,
          phone: bookingInfo.phone,
          to_number: bookingInfo.phone
        });
        
        // Update system prompt with the actual customer name if we have it
        if (bookingInfo.name && bookingInfo.name.trim() !== '') {
          const systemPrompt = conversationHistory[0].content;
          conversationHistory[0].content = systemPrompt
            .replace(/\[Name\]/g, bookingInfo.name)
            .replace(/Monica/g, bookingInfo.name);
          console.log(`✅ Updated system prompt with customer name: ${bookingInfo.name}`);
        }
        
        // Log final captured info
        console.log(`✅ Final captured customer info for call ${connectionData.callId}:`, {
          name: bookingInfo.name,
          email: bookingInfo.email,
          phone: bookingInfo.phone,
          collectedContactInfo: collectedContactInfo
        });
        
        // CRITICAL: Verify we have the email
        if (!bookingInfo.email || bookingInfo.email.trim() === '') {
          console.error('❌ CRITICAL: Still no email found after all attempts!');
          console.error('Call metadata:', JSON.stringify(parsed.call.metadata, null, 2));
          console.error('Call object keys:', Object.keys(parsed.call));
        } else {
          console.log('✅ SUCCESS: Email confirmed available for webhook:', bookingInfo.email);
        }
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('User said:', userMessage);
        console.log('Current conversation state:', conversationState);
        console.log('Current email status:', bookingInfo.email ? 'Available' : 'NOT AVAILABLE');

        // IMPROVED: Better discovery answer tracking
        if (conversationState === 'discovery') {
          // Match user answers to questions
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            
            // Check which discovery question was asked
            for (let i = 0; i < discoveryQuestions.length; i++) {
              const question = discoveryQuestions[i];
              const shortQuestionStart = question.toLowerCase().substring(0, 15);
              
              // Check if bot message contains this question
              if (lastBotMessage.content.toLowerCase().includes(shortQuestionStart)) {
                // Store the answer with question index
                discoveryData[`question_${i}`] = userMessage;
                console.log(`✅ Stored answer to question ${i}: ${question} = "${userMessage}"`);
                
                // Try to set the variable for the Retell call as well
                try {
                  if (parsed.call && parsed.call.call_id) {
                    const variableKey = `discovery_q${i}`;
                    const variableData = {
                      variables: {
                        [variableKey]: userMessage
                      }
                    };
                    
                    // Set the variable on the Retell call
                    axios.post(`https://api.retellai.com/v1/calls/${parsed.call.call_id}/variables`, 
                      variableData, 
                      {
                        headers: {
                          'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
                          'Content-Type': 'application/json'
                        }
                      }
                    ).catch(err => console.error(`Error setting discovery variable ${variableKey}:`, err));
                  }
                } catch (varError) {
                  console.error('Error setting call variable:', varError);
                }
                
                break;
              }
            }
          }
        }
        
        // Check if user wants to schedule
        if (userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
          console.log('User requested scheduling');
          // Only move to booking if we've completed discovery
          if (discoveryProgress.allQuestionsAsked) {
            conversationState = 'booking';
          }
        }
        
        // IMPROVED: Better day preference detection
        if (conversationState === 'booking' || 
           (conversationState === 'discovery' && discoveryProgress.allQuestionsAsked)) {
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo && !webhookSent) {
            bookingInfo.preferredDay = dayInfo.dayName;
            
            console.log('📅 Day preference detected:', bookingInfo.preferredDay);
            console.log('📧 Email status before webhook:', bookingInfo.email ? 'Available' : 'MISSING');
            
            // CRITICAL: Final check for email before sending webhook
            if (!bookingInfo.email || bookingInfo.email.trim() === '') {
              console.error('❌ ATTEMPTING FINAL EMAIL RECOVERY...');
              
              // Try global typeform submission
              if (global.lastTypeformSubmission && global.lastTypeformSubmission.email) {
                bookingInfo.email = global.lastTypeformSubmission.email;
                bookingInfo.name = bookingInfo.name || global.lastTypeformSubmission.name;
                console.log('✅ Recovered email from global submission:', bookingInfo.email);
              }
              
              // Try active calls metadata
              if (!bookingInfo.email && connectionData.callId && activeCallsMetadata.has(connectionData.callId)) {
                const callMeta = activeCallsMetadata.get(connectionData.callId);
                if (callMeta && callMeta.customer_email) {
                  bookingInfo.email = callMeta.customer_email;
                  console.log('✅ Recovered email from active calls metadata:', bookingInfo.email);
                }
              }
            }
            
            // Alert the Retell agent through custom variables
            try {
              if (parsed.call && parsed.call.call_id) {
                await axios.post(`https://api.retellai.com/v1/calls/${parsed.call.call_id}/variables`, {
                  variables: {
                    preferredDay: bookingInfo.preferredDay,
                    schedulingComplete: true,
                    // Include full discovery data
                    discovery_data: JSON.stringify(discoveryData)
                  }
                }, {
                  headers: {
                    'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
                    'Content-Type': 'application/json'
                  }
                });
                console.log('✅ Set Retell call variables for scheduling and discovery data');
              }
            } catch (variableError) {
              console.error('Error setting Retell variables:', variableError);
            }
            
            // Immediately send data to trigger server when we get a day preference
            console.log('📤 Sending scheduling preference to trigger server with all collected data');
            console.log('📧 Final email before webhook:', bookingInfo.email);
            console.log('📋 Discovery data:', JSON.stringify(discoveryData, null, 2));
            
            const result = await sendSchedulingPreference(
              bookingInfo.name,
              bookingInfo.email,
              bookingInfo.phone,
              bookingInfo.preferredDay,
              connectionData.callId,
              discoveryData
            );
            
            // Mark as sent and continue conversation naturally
            bookingInfo.schedulingLinkSent = true;
            conversationState = 'completed';
            webhookSent = true;
            
            // Update conversation state in trigger server
            if (connectionData.callId) {
              await updateConversationState(connectionData.callId, true, bookingInfo.preferredDay);
            }
            
            console.log('✅ Data sent to n8n and conversation marked as completed');
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
            temperature: 0.7 // Increased for more natural responses
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 8000 // Increased timeout for more reliable responses
          }
        );

        const botReply = openaiResponse.data.choices[0].message.content || "Haha, could you tell me a bit more about that?";

        // Add bot reply to conversation history
        conversationHistory.push({ role: 'assistant', content: botReply });

        // Check if discovery is complete based on bot reply
        const discoveryComplete = trackDiscoveryQuestions(botReply, discoveryProgress, discoveryQuestions);
        
        // Transition state based on content and tracking
        if (conversationState === 'introduction') {
          // Move to discovery after introduction
          conversationState = 'discovery';
        } else if (conversationState === 'discovery' && discoveryComplete) {
          // Transition to booking if all discovery questions are asked
          conversationState = 'booking';
          
          // Update conversation state in trigger server
          if (connectionData.callId) {
            updateConversationState(connectionData.callId, true, null);
          }
          
          console.log('Transitioning to booking state based on discovery completion');
        }

        // Send the AI response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
        // After sending the response, check if this should be our last message
        if (conversationState === 'completed' && !webhookSent && botReply.toLowerCase().includes('scheduling')) {
          // If we're in the completed state and talking about scheduling but haven't sent the webhook yet
          if (bookingInfo.email || connectionData.metadata?.customer_email) {
            console.log('Sending final webhook before conversation end');
            await sendSchedulingPreference(
              bookingInfo.name || connectionData.metadata?.customer_name || '',
              bookingInfo.email || connectionData.metadata?.customer_email || '',
              bookingInfo.phone || connectionData.metadata?.to_number || '',
              bookingInfo.preferredDay || 'Not specified',
              connectionData.callId,
              discoveryData
            );
            webhookSent = true;
          }
        }
      }
    } catch (error) {
      console.error('Error handling message:', error.message);
      
      // Always try to send whatever data we have if an error occurs
      if (!webhookSent && connectionData.callId && (bookingInfo.email || connectionData.metadata?.customer_email)) {
        try {
          console.log('Sending webhook due to error');
          await sendSchedulingPreference(
            bookingInfo.name || connectionData.metadata?.customer_name || '',
            bookingInfo.email || connectionData.metadata?.customer_email || '',
            bookingInfo.phone || connectionData.metadata?.to_number || '',
            bookingInfo.preferredDay || 'Not specified',
            connectionData.callId,
            discoveryData
          );
          webhookSent = true;
        } catch (webhookError) {
          console.error('Failed to send webhook after error:', webhookError);
        }
      }
      
      // Send a recovery message
      ws.send(JSON.stringify({
        content: "Haha oops, I missed that. Could you say it one more time?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });

  ws.on('close', async () => {
    console.log('Connection closed.');
    clearTimeout(autoGreetingTimer); // Clear the timer when connection closes
    
    // ALWAYS send data to trigger server when call ends, regardless of completion status
    if (!webhookSent && connectionData.callId) {
      try {
        // Get any metadata we can find for this call
        if (!bookingInfo.name && connectionData?.metadata?.customer_name) {
          bookingInfo.name = connectionData.metadata.customer_name;
        }
        if (!bookingInfo.email && connectionData?.metadata?.customer_email) {
          bookingInfo.email = connectionData.metadata.customer_email;
        }
        if (!bookingInfo.phone && connectionData?.metadata?.to_number) {
          bookingInfo.phone = connectionData.metadata.to_number;
        }

        console.log('Connection closed - sending final webhook data with discovery info:', discoveryData);
        await sendSchedulingPreference(
          bookingInfo.name || '',
          bookingInfo.email || '',
          bookingInfo.phone || '',
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          discoveryData
        );
        console.log(`Final data sent for call ${connectionData.callId}`);
        webhookSent = true;
      } catch (finalError) {
        console.error('Error sending final webhook:', finalError.message);
      }
      
      // Clean up
      activeCallsMetadata.delete(connectionData.callId);
      console.log(`Cleaned up metadata for call ${connectionData.callId}`);
    }
  });
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

// DEBUG ENDPOINTS
// Add this debug endpoint to your WebSocket server for testing
app.post('/debug-call-setup', express.json(), async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    
    console.log('=== DEBUG CALL SETUP ===');
    console.log('Input data:', { name, email, phone });
    
    // Test 1: Store globally
    const globalStored = storeContactInfoGlobally(name, email, phone, 'Debug Test');
    console.log('Global storage result:', globalStored);
    console.log('Global lastTypeformSubmission:', global.lastTypeformSubmission);
    
    // Test 2: Make call to trigger server
    const triggerResponse = await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/trigger-retell-call`, {
      name,
      email,
      phone,
      userId: `debug_${Date.now()}`
    });
    
    console.log('Trigger server response:', triggerResponse.data);
    
    // Test 3: Check if call was stored correctly
    if (triggerResponse.data.call_id) {
      setTimeout(async () => {
        try {
          const callInfoResponse = await axios.get(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/get-call-info/${triggerResponse.data.call_id}`);
          console.log('Retrieved call info:', callInfoResponse.data);
        } catch (error) {
          console.error('Error retrieving call info:', error.message);
        }
      }, 2000);
    }
    
    res.status(200).json({
      success: true,
      message: 'Debug call setup completed',
      global_storage: globalStored,
      global_data: global.lastTypeformSubmission,
      trigger_response: triggerResponse.data
    });
    
  } catch (error) {
    console.error('Debug call setup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add this endpoint to test webhook sending directly
app.post('/debug-webhook-test', express.json(), async (req, res) => {
  try {
    const { name, email, phone, preferredDay } = req.body;
    
    console.log('=== DEBUG WEBHOOK TEST ===');
    console.log('Input:', { name, email, phone, preferredDay });
    
    // Store globally first
    storeContactInfoGlobally(name, email, phone, 'Debug Webhook Test');
    
    // Test discovery data
    const testDiscoveryData = {
      'question_0': 'Instagram',
      'question_1': 'Solar',
      'question_2': 'Solar panels',
      'question_3': 'No',
      'question_4': 'Yes. Go high level',
      'question_5': 'Not following up leads quickly'
    };
    
    // Send webhook
    const result = await sendSchedulingPreference(
      name,
      email,
      phone,
      preferredDay || 'Monday',
      `debug_call_${Date.now()}`,
      testDiscoveryData
    );
    
    res.status(200).json({
      success: true,
      message: 'Debug webhook test completed',
      webhook_result: result,
      discovery_data: testDiscoveryData
    });
    
  } catch (error) {
    console.error('Debug webhook test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server with Calendly scheduling link integration is listening on port ${PORT}`);
});
