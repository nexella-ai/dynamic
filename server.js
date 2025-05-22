require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with Calendly scheduling link integration is live!');
});

// Store active calls metadata
const activeCallsMetadata = new Map();

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

// FIXED: Proper customer data extraction and webhook sending
async function sendSchedulingPreference(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    console.log('=== WEBHOOK SENDING DEBUG ===');
    console.log('Input parameters:', { name, email, phone, preferredDay, callId });
    
    // Get metadata from active calls if callId exists
    let finalName = name;
    let finalEmail = email;
    let finalPhone = phone;
    
    if (callId && activeCallsMetadata.has(callId)) {
      const callMetadata = activeCallsMetadata.get(callId);
      console.log('Found call metadata:', callMetadata);
      
      // Use metadata values if input parameters are missing or empty
      if (!finalName && callMetadata.customer_name) {
        finalName = callMetadata.customer_name;
        console.log(`Retrieved name from metadata: ${finalName}`);
      }
      
      if (!finalEmail && callMetadata.customer_email) {
        finalEmail = callMetadata.customer_email;
        console.log(`Retrieved email from metadata: ${finalEmail}`);
      }
      
      if (!finalPhone && (callMetadata.phone || callMetadata.to_number)) {
        finalPhone = callMetadata.phone || callMetadata.to_number;
        console.log(`Retrieved phone from metadata: ${finalPhone}`);
      }
    }
    
    // Validate that we have at least an email (required field)
    if (!finalEmail || finalEmail.trim() === '') {
      console.error('ERROR: No email found in parameters or metadata');
      console.log('Available metadata keys:', callId ? Object.keys(activeCallsMetadata.get(callId) || {}) : 'No call ID');
      return { success: false, error: 'Email is required but not found' };
    }
    
    // Format phone number properly
    if (finalPhone && !finalPhone.startsWith('+')) {
      finalPhone = '+1' + finalPhone.replace(/[^0-9]/g, '');
    }
    
    // Format discovery data to match Airtable field names exactly
    const formattedDiscoveryData = {};
    const fieldMappings = {
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry', 
      'question_2': 'Main product',
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
    };
    
    // Process discovery data with exact field mappings
    Object.entries(discoveryData).forEach(([key, value]) => {
      if (fieldMappings[key]) {
        formattedDiscoveryData[fieldMappings[key]] = value;
      } else {
        formattedDiscoveryData[key] = value;
      }
    });
    
    // Build final webhook payload
    const webhookData = {
      name: finalName || '',
      email: finalEmail,  // This should now always have a value
      phone: finalPhone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData
    };
    
    console.log('Final webhook payload:', JSON.stringify(webhookData, null, 2));
    
    // Send to trigger server first
    const triggerServerUrl = process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
    console.log(`Sending to trigger server: ${triggerServerUrl}/process-scheduling-preference`);
    
    try {
      const response = await axios.post(`${triggerServerUrl}/process-scheduling-preference`, webhookData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      console.log('SUCCESS: Trigger server response:', response.data);
      return { success: true, data: response.data };
      
    } catch (triggerError) {
      console.error('Trigger server failed:', triggerError.message);
      
      // Try direct n8n webhook as backup
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
      console.log(`Trying direct n8n webhook: ${n8nWebhookUrl}`);
      
      try {
        const n8nResponse = await axios.post(n8nWebhookUrl, webhookData, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });
        
        console.log('SUCCESS: Direct n8n response:', n8nResponse.data);
        return { success: true, fallback: true, data: n8nResponse.data };
        
      } catch (n8nError) {
        console.error('Both webhook attempts failed:', n8nError.message);
        return { success: false, error: `Both trigger server and n8n failed: ${triggerError.message}, ${n8nError.message}` };
      }
    }
    
  } catch (error) {
    console.error('Critical error in sendSchedulingPreference:', error);
    return { success: false, error: error.message };
  }
}

// Better detection of discovery questions being asked and answered
function trackDiscoveryQuestions(botMessage, discoveryProgress, discoveryQuestions) {
  if (!botMessage) return false;
  
  const botMessageLower = botMessage.toLowerCase();
  
  // Key phrases to detect in the bot's message that indicate specific discovery questions
  const keyPhrases = [
    ["hear about us", "find us", "discover us", "found us", "discovered nexella"],
    ["business", "company", "industry", "what do you do", "line of business", "business model"],
    ["product", "service", "offer", "price point", "main product", "typical price"],
    ["ads", "advertising", "marketing", "meta", "google", "tiktok", "running ads"],
    ["crm", "gohighlevel", "management system", "customer relationship", "using any crm"],
    ["problems", "challenges", "issues", "pain points", "difficulties", "running into", "what problems"]
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
  
  console.log(`Question progress: ${discoveryProgress.questionsAsked.size}/${discoveryQuestions.length}, Scheduling phrase: ${hasSchedulingPhrase}`);
  
  const discoveryComplete = (hasEnoughQuestions && hasSchedulingPhrase) || hasAllQuestions;
  
  if (discoveryComplete) {
    console.log('Discovery process considered complete!');
  }
  
  discoveryProgress.allQuestionsAsked = discoveryComplete;
  return discoveryComplete;
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

// FIXED: Better data extraction from Retell call request
app.post('/trigger-retell-call', express.json(), async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    console.log('=== INCOMING RETELL CALL REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Validate required email
    if (!email || email.trim() === '') {
      console.error('ERROR: Email is required but missing from request');
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    const userIdentifier = userId || `user_${phone || Date.now()}`;
    
    // Prepare metadata that will be sent to the voice agent
    const metadata = {
      customer_name: name || '',
      customer_email: email.trim(),
      customer_phone: phone || '',
      typeform_source: true  // Flag to indicate this came from Typeform
    };
    
    console.log('Metadata being sent to Retell:', metadata);
    
    // Prepare initial variables for the LLM
    const initialVariables = {
      customer_name: name || '',
      customer_email: email.trim(),
      has_typeform_data: true
    };
    
    // Make call to Retell API
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
    console.log('Call response:', response.data);
    
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

// FIXED: WebSocket connection with proper data handling
wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');
  
  const connectionData = {
    callId: null,
    metadata: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };
  
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
- We already have the customer's name and email from their Typeform submission
- Address the customer by their actual name (NOT a placeholder name like Monica)
- You don't need to ask for their email again
- Ask one question at a time and pause for answers
- Acknowledge their answers before moving to the next question

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

Remember: You MUST ask ALL SIX discovery questions before scheduling. Complete each sentence fully, speak slowly, and add natural pauses between thoughts. Always use their actual name from the Typeform data.`
    }
  ];

  // States for conversation flow
  let conversationState = 'introduction';
  let bookingInfo = {
    name: '',
    email: '',
    phone: '',
    preferredDay: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let discoveryData = {};
  let collectedContactInfo = false;
  let userHasSpoken = false;
  let webhookSent = false;

  // Send connecting message
  ws.send(JSON.stringify({
    content: "connecting...",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  // Auto-greeting timer
  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      ws.send(JSON.stringify({
        content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 5000);

  ws.on('message', async (data) => {
    try {
      clearTimeout(autoGreetingTimer);
      userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      
      // FIXED: Better call metadata extraction and storage
      if (parsed.call && parsed.call.call_id && !connectionData.callId) {
        connectionData.callId = parsed.call.call_id;
        
        console.log('=== CALL METADATA EXTRACTION ===');
        console.log('Full call object:', JSON.stringify(parsed.call, null, 2));
        
        if (parsed.call.metadata) {
          connectionData.metadata = parsed.call.metadata;
          console.log('Extracted metadata:', connectionData.metadata);
          
          // Extract customer info from metadata
          if (connectionData.metadata.customer_name) {
            bookingInfo.name = connectionData.metadata.customer_name;
            console.log(`Set customer name: ${bookingInfo.name}`);
          }
          
          if (connectionData.metadata.customer_email) {
            bookingInfo.email = connectionData.metadata.customer_email;
            console.log(`Set customer email: ${bookingInfo.email}`);
          }
          
          if (connectionData.metadata.customer_phone) {
            bookingInfo.phone = connectionData.metadata.customer_phone;
            console.log(`Set customer phone: ${bookingInfo.phone}`);
          }
          
          // Also check for phone in to_number
          if (!bookingInfo.phone && parsed.call.to_number) {
            bookingInfo.phone = parsed.call.to_number;
            console.log(`Set phone from to_number: ${bookingInfo.phone}`);
          }
          
          // Store this call's metadata globally for later access
          activeCallsMetadata.set(connectionData.callId, {
            customer_name: bookingInfo.name,
            customer_email: bookingInfo.email,
            customer_phone: bookingInfo.phone,
            to_number: parsed.call.to_number,
            phone: bookingInfo.phone
          });
          
          console.log(`Stored metadata for call ${connectionData.callId}:`, {
            name: bookingInfo.name,
            email: bookingInfo.email,
            phone: bookingInfo.phone
          });
          
          collectedContactInfo = true;
        }
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('User said:', userMessage);
        console.log('Current conversation state:', conversationState);

        // Track discovery answers
        if (conversationState === 'discovery') {
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            
            for (let i = 0; i < discoveryQuestions.length; i++) {
              const question = discoveryQuestions[i];
              const shortQuestionStart = question.toLowerCase().substring(0, 15);
              
              if (lastBotMessage.content.toLowerCase().includes(shortQuestionStart)) {
                discoveryData[`question_${i}`] = userMessage;
                console.log(`Stored answer to question ${i}: ${question} = ${userMessage}`);
                break;
              }
            }
          }
        }
        
        // Check for scheduling request
        if (userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
          console.log('User requested scheduling');
          if (discoveryProgress.allQuestionsAsked) {
            conversationState = 'booking';
          }
        }
        
        // Handle day preference
        if (conversationState === 'booking' || 
           (conversationState === 'discovery' && discoveryProgress.allQuestionsAsked)) {
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo && !webhookSent) {
            bookingInfo.preferredDay = dayInfo.dayName;
            console.log(`Detected preferred day: ${bookingInfo.preferredDay}`);
            
            // Send webhook immediately when we get a day preference
            console.log('=== SENDING WEBHOOK FOR DAY PREFERENCE ===');
            const result = await sendSchedulingPreference(
              bookingInfo.name,
              bookingInfo.email,
              bookingInfo.phone,
              bookingInfo.preferredDay,
              connectionData.callId,
              discoveryData
            );
            
            if (result.success) {
              webhookSent = true;
              bookingInfo.schedulingLinkSent = true;
              conversationState = 'completed';
              console.log('Webhook sent successfully, marking as completed');
            } else {
              console.error('Webhook failed:', result.error);
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

        // Check if discovery is complete based on bot reply
        const discoveryComplete = trackDiscoveryQuestions(botReply, discoveryProgress, discoveryQuestions);
        
        // Transition conversation state
        if (conversationState === 'introduction') {
          conversationState = 'discovery';
        } else if (conversationState === 'discovery' && discoveryComplete) {
          conversationState = 'booking';
          console.log('Transitioning to booking state');
        }

        // Send the AI response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
      }

    } catch (error) {
      console.error('Error handling message:', error.message);
      
      // Send error recovery message
      ws.send(JSON.stringify({
        content: "I'm sorry, could you repeat that?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });

  ws.on('close', async () => {
    console.log('=== WEBSOCKET CONNECTION CLOSED ===');
    clearTimeout(autoGreetingTimer);
    
    // Send final webhook if not already sent and we have customer data
    if (!webhookSent && connectionData.callId && bookingInfo.email) {
      try {
        console.log('Sending final webhook on connection close');
        await sendSchedulingPreference(
          bookingInfo.name || '',
          bookingInfo.email || '',
          bookingInfo.phone || '',
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          discoveryData
        );
        console.log(`Final webhook sent for call ${connectionData.callId}`);
      } catch (finalError) {
        console.error('Error sending final webhook:', finalError.message);
      }
    }
    
    // Clean up
    if (connectionData.callId) {
      activeCallsMetadata.delete(connectionData.callId);
      console.log(`Cleaned up metadata for call ${connectionData.callId}`);
    }
  });
});

// Retell webhook endpoint
app.post('/retell-webhook', express.json(), async (req, res) => {
  try {
    const { event, call } = req.body;
    
    console.log(`=== RETELL WEBHOOK: ${event} ===`);
    
    if (call && call.call_id) {
      console.log(`Call ID: ${call.call_id}, Status: ${call.call_status}`);
      
      // Extract customer data
      const email = call.metadata?.customer_email || '';
      const name = call.metadata?.customer_name || '';
      const phone = call.to_number || '';
      let preferredDay = '';
      let discoveryData = {};
      
      // Look for preferred day in call variables
      if (call.variables && call.variables.preferredDay) {
        preferredDay = call.variables.preferredDay;
      }
      
      // Extract discovery data from variables
      if (call.variables) {
        Object.entries(call.variables).forEach(([key, value]) => {
          if (key.startsWith('discovery_') || key.includes('question_')) {
            discoveryData[key] = value;
          }
        });
      }
      
      // Send webhook for call ending events
      if ((event === 'call_ended' || event === 'call_analyzed') && email) {
        console.log(`Sending webhook for ${event} event`);
        
        try {
          const result = await sendSchedulingPreference(
            name,
            email,
            phone,
            preferredDay || 'Not specified',
            call.call_id,
            discoveryData
          );
          
          console.log(`Webhook result for ${event}:`, result);
        } catch (error) {
          console.error(`Error sending webhook for ${event}:`, error);
        }
      }
      
      // Clean up stored data
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
  console.log(`Nexella WebSocket Server is listening on port ${PORT}`);
});
