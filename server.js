require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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

// Update conversation state in trigger server to track discovery completion
async function updateConversationState(callId, discoveryComplete, selectedSlot) {
  try {
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/update-conversation`, {
      call_id: callId,
      discoveryComplete,
      selectedSlot
    });
    console.log(`Updated conversation state for call ${callId}:`, response.data);
    return response.data.success;
  } catch (error) {
    console.error('Error updating conversation state:', error.message);
    return false;
  }
}

// UPDATED: Always send data to n8n, whether scheduling fully completed or not
async function sendDataToN8n(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    // Send all collected data to n8n webhook
    const webhookData = {
      name: name || '',
      email: email || '',
      phone: phone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      discovery_data: discoveryData,
      timestamp: new Date().toISOString(),
      call_completed: true // You could set this based on various criteria
    };
    
    const response = await axios.post(process.env.N8N_WEBHOOK_URL, webhookData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000 // 5 second timeout
    });
    
    console.log('Successfully sent data to n8n:', response.data);
    return { success: true, response: response.data };
  } catch (error) {
    console.error('Error sending data to n8n:', error.message);
    
    // Retry once if failed
    try {
      await axios.post(process.env.N8N_WEBHOOK_URL, webhookData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      console.log('Retry successful - data sent to n8n');
      return { success: true, message: 'Sent on retry' };
    } catch (retryError) {
      console.error('Retry failed:', retryError.message);
      // Even if it fails, we'll return success to continue the conversation
      // You can implement a queue system here if needed
      return { success: false, error: retryError.message };
    }
  }
}

// Function to handle scheduling preferences with simplified flow
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

// Improved function to detect when all discovery questions have been asked
function trackDiscoveryQuestions(botMessage, discoveryProgress, discoveryQuestions) {
  if (!botMessage) return false;
  
  const botMessageLower = botMessage.toLowerCase();
  
  // Key phrases to detect in the bot's message that indicate specific discovery questions
  const keyPhrases = [
    ["hear about us", "find us", "discover us"], // How did you hear about us
    ["business", "company", "industry", "what do you do"], // What line of business are you in
    ["product", "service", "offer", "price point"], // What's your main product
    ["ads", "advertising", "marketing", "meta", "google", "tiktok"], // Are you running ads
    ["crm", "gohighlevel", "management system", "customer relationship"], // Are you using a CRM
    ["problems", "challenges", "issues", "pain points", "difficulties"] // What problems are you facing
  ];
  
  // Check each question's key phrases
  keyPhrases.forEach((phrases, index) => {
    if (phrases.some(phrase => botMessageLower.includes(phrase))) {
      discoveryProgress.questionsAsked.add(index);
    }
  });
  
  // Check if we've moved to scheduling questions
  if (botMessageLower.includes("schedule") || 
      botMessageLower.includes("book a call") || 
      botMessageLower.includes("day of the week") ||
      botMessageLower.includes("what day works")) {
    discoveryProgress.allQuestionsAsked = true;
    return true;
  }
  
  // Check if all questions have been asked
  const allAsked = discoveryProgress.questionsAsked.size >= discoveryQuestions.length;
  discoveryProgress.allQuestionsAsked = allAsked;
  
  return allAsked;
}

wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');
  
  // Store connection data with this WebSocket
  const connectionData = {
    callId: null,
    metadata: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };
  
  // Define discovery questions as a trackable list
  const discoveryQuestions = [
    'How did you hear about us?',
    'What line of business are you in? What\'s your business model?',
    'What\'s your main product and typical price point?',
    'Are you running ads (Meta, Google, TikTok)?',
    'Are you using a CRM like GoHighLevel?',
    'What problems are you running into?'
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: 0,
    questionsAsked: new Set(),
    allQuestionsAsked: false
  };
  
  // UPDATED: Improved system prompt with name awareness and natural conversation
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella.

PERSONALITY & TONE:
- Be friendly, relatable, and casual - like talking to a friend
- Use contractions and natural speech patterns
- Laugh occasionally (use "haha" or "hehe" naturally)
- Sound genuinely excited about helping them
- Match their energy and speaking style
- Sprinkle in casual phrases like "totally", "awesome", "for sure", "definitely"

KEY REMINDERS:
- We ALREADY have their name and email from their typeform submission
- Address them by name early in the conversation
- You don't need to ask for their email again
- Be conversational, not checklist-like
- Ask ONE question at a time
- Wait for answers before moving forward
- Show genuine interest in their responses

CONVERSATION FLOW:
1. INTRODUCTION: "Hi [Name]! This is Sarah from Nexella. [warm greeting with a laugh]"
2. DISCOVERY (ask naturally, not like an interview):
   - How did you discover us?
   - What's your business all about?
   - What's your main product/service?
   - Are you running any ads right now?
   - Using any CRM systems?
   - What challenges are you facing?
3. SCHEDULING: Only ask for what DAY works for them
   - "So when would be a good day for us to hop on a call?"
   - Once they mention ANY day, say you'll send a scheduling link
   - Don't ask for specific times - the link handles that

SCHEDULING APPROACH:
- When they mention ANY day (today, tomorrow, Monday, next week, etc.), immediately confirm
- Say something like: "Perfect! I'll send you a scheduling link for [day] and you can pick whatever time works best"
- Emphasize they already have an account/email with us
- Make it super easy and casual

NATURAL RESPONSES:
- If they say "Monday": "Monday works great! I'll shoot you a link for Monday and you can grab whatever time slot looks good to you."
- If they say "next week": "Awesome, next week it is! I'll send you a scheduling link and you can pick any day/time that works."
- If they're vague: "No worries! I'll send you our scheduling link and you can pick whatever day and time works best for you."

Remember: Your goal is to have a natural, friendly conversation that leads to sending them a scheduling link. Keep it light, casual, and make them feel comfortable!`
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
      
      // Check if this is a call initialization message (contains call object with metadata)
      if (parsed.call && parsed.call.call_id && !connectionData.callId) {
        connectionData.callId = parsed.call.call_id;
        
        // Store call metadata if available
        if (parsed.call.metadata) {
          connectionData.metadata = parsed.call.metadata;
          console.log('Call metadata received:', connectionData.metadata);
          
          // Extract customer info from metadata if available
          if (connectionData.metadata.customer_name) {
            bookingInfo.name = connectionData.metadata.customer_name;
            collectedContactInfo = true;
            
            // Update system prompt with the user's name
            conversationHistory[0].content = conversationHistory[0].content.replace(/\[Name\]/g, bookingInfo.name);
          }
          if (connectionData.metadata.customer_email) {
            bookingInfo.email = connectionData.metadata.customer_email;
            collectedContactInfo = true;
          }
          if (connectionData.metadata.phone) {
            bookingInfo.phone = connectionData.metadata.phone;
            collectedContactInfo = true;
          }
          
          // Store this call's metadata globally
          activeCallsMetadata.set(connectionData.callId, connectionData.metadata);
        }
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('User said:', userMessage);
        console.log('Current conversation state:', conversationState);

        // Store discovery answers
        if (conversationState === 'discovery') {
          // Simple heuristic to match user answers to questions
          // You could make this more sophisticated
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            for (let i = 0; i < discoveryQuestions.length; i++) {
              const question = discoveryQuestions[i];
              if (lastBotMessage.content.toLowerCase().includes(question.toLowerCase().substring(0, 10))) {
                discoveryData[`question_${i}`] = userMessage;
                break;
              }
            }
          }
        }
        
        // Check if user wants to schedule
        if (userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
          console.log('User requested scheduling');
          conversationState = 'booking';
        }
        
        // Handle day preference
        if (conversationState === 'booking') {
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo) {
            bookingInfo.preferredDay = dayInfo.dayName;
            
            // Immediately send data to n8n when we get a day preference
            const result = await sendDataToN8n(
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
            
            // Send a natural completion response
            ws.send(JSON.stringify({
              content: `Perfect! I'll send you our scheduling link for ${bookingInfo.preferredDay} right after our call. You can pick any time that works for you. Is there anything else you'd like to know about Nexella before we wrap up?`,
              content_complete: true,
              actions: [],
              response_id: parsed.response_id
            }));
            
            console.log('Data sent to n8n and conversation marked as completed');
            return;
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
            timeout: 5000
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
      }

    } catch (error) {
      console.error('Error handling message:', error.message);
      
      // Always try to send whatever data we have to n8n if an error occurs
      if (connectionData.callId && bookingInfo.name) {
        if (!bookingInfo.name && connectionData?.metadata?.customer_name) {
          bookingInfo.name = connectionData.metadata.customer_name;
        }
        if (!bookingInfo.email && connectionData?.metadata?.customer_email) {
          bookingInfo.email = connectionData.metadata.customer_email;
        }
        if (!bookingInfo.phone && connectionData?.metadata?.phone) {
          bookingInfo.phone = connectionData.metadata.phone;
        }

        await sendDataToN8n(
          bookingInfo.name,
          bookingInfo.email,
          bookingInfo.phone,
          bookingInfo.preferredDay || 'Not specified',
          connectionData.callId,
          discoveryData
        );
      }
      
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
    
    // ALWAYS send data to n8n when call ends, regardless of completion status
    if (connectionData.callId) {
      try {
        if (!bookingInfo.name && connectionData?.metadata?.customer_name) {
          bookingInfo.name = connectionData.metadata.customer_name;
        }
        if (!bookingInfo.email && connectionData?.metadata?.customer_email) {
          bookingInfo.email = connectionData.metadata.customer_email;
        }
        if (!bookingInfo.phone && connectionData?.metadata?.phone) {
          bookingInfo.phone = connectionData.metadata.phone;
        }

        await sendDataToN8n(
          bookingInfo.name,
          bookingInfo.email,
          bookingInfo.phone,
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          discoveryData
        );
        console.log(`Final data sent to n8n for call ${connectionData.callId}`);
      } catch (finalError) {
        console.error('Error sending final data to n8n:', finalError.message);
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
      
      // Handle different webhook events
      if (event === 'call_ended') {
        // Clean up any stored data
        activeCallsMetadata.delete(call.call_id);
        console.log(`Call ${call.call_id} ended, cleaned up metadata`);
        
        // You could implement additional webhook handling here
        // For example, final data verification or status updates
      }
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
