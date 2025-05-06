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

// UPDATED: Modified to work with n8n
async function sendSchedulingLinkToEmail(name, email, phone, preferredDay, preferredTime, callId) {
  try {
    // Use the process-scheduling-preference endpoint
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/process-scheduling-preference`, {
      name,
      email,
      phone,
      preferredDay,
      preferredTime,
      call_id: callId
    });
    
    return { 
      success: response.data.success, 
      message: response.data.message,
      schedulingLink: response.data.schedulingLink
    };
  } catch (error) {
    console.error('Error sending scheduling link:', error.response?.data || error.message);
    return { 
      success: false, 
      message: 'Failed to send scheduling link. Please try again.'
    };
  }
}

// Function to handle scheduling preferences better
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
      dayName: 'Next week',
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
        dayName: 'Tomorrow',
        date: targetDate,
        isSpecific: true
      };
    } else if (preferredDay === 'today') {
      return {
        dayName: 'Today',
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
          dayName: capitalizeFirstLetter(preferredDay),
          date: targetDate,
          isSpecific: true
        };
      }
    }
  }
  
  return null;
}

// Function to format a better response for available times
function formatAvailableTimeResponse(preferredDay, slots) {
  if (!slots || slots.length === 0) {
    return `I'm sorry, it looks like we don't have any available slots for ${preferredDay}. Would you like to try another day?`;
  }
  
  // Format slots for natural language (show max 3)
  const slotsToShow = slots.slice(0, 3);
  const formattedSlots = slotsToShow.map(slot => {
    const date = new Date(slot.startTime);
    return `${date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })}`;
  });
  
  if (formattedSlots.length === 1) {
    return `Great! For ${preferredDay}, we typically have availability at ${formattedSlots[0]}. I'll send you a scheduling link where you can select the exact time that works best for you. What's your preferred time?`;
  } else if (formattedSlots.length === 2) {
    return `Great! For ${preferredDay}, we typically have availability at ${formattedSlots[0]} or ${formattedSlots[1]}. I'll send you a scheduling link where you can select the exact time that works best for you. Do you have a preference between these times?`;
  } else {
    return `Great! For ${preferredDay}, we typically have availability at ${formattedSlots[0]}, ${formattedSlots[1]}, or ${formattedSlots[2]}. I'll send you a scheduling link where you can select the exact time that works best for you. Do you have a preference among these times?`;
  }
}

// Function to extract time from user message more accurately
function extractTimeFromMessage(userMessage, availableSlots) {
  // Check for explicit time mention
  const timeRegex = /(\d{1,2})(:\d{2})?\s*(am|pm)?/i;
  const timeMatch = userMessage.match(timeRegex);
  
  if (timeMatch) {
    // Get the hour and convert to 24-hour format if needed
    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2] ? parseInt(timeMatch[2].substring(1)) : 0;
    const isPM = timeMatch[3]?.toLowerCase() === 'pm';
    
    // Convert to 24-hour format
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    
    // Find the closest slot
    return availableSlots.find(slot => {
      const slotTime = new Date(slot.startTime);
      // Check if the hour matches and either minutes match or weren't specified
      return slotTime.getHours() === hour && 
             (minute === 0 || slotTime.getMinutes() === minute);
    });
  }
  
  // Check if user is agreeing to a suggested time
  if (userMessage.toLowerCase().match(/\b(yes|sure|ok|okay|sounds good|that works|first one|second one|third one|earliest|latest|morning|afternoon|evening)\b/)) {
    // Return the first available slot as default or look for specific period of day
    if (userMessage.toLowerCase().includes('morning')) {
      // Find a morning slot (9am-12pm)
      const morningSlot = availableSlots.find(slot => {
        const hour = new Date(slot.startTime).getHours();
        return hour >= 9 && hour < 12;
      });
      return morningSlot || availableSlots[0];
    } else if (userMessage.toLowerCase().includes('afternoon')) {
      // Find an afternoon slot (12pm-5pm)
      const afternoonSlot = availableSlots.find(slot => {
        const hour = new Date(slot.startTime).getHours();
        return hour >= 12 && hour < 17;
      });
      return afternoonSlot || availableSlots[0];
    } else if (userMessage.toLowerCase().includes('evening')) {
      // Find an evening slot (5pm+)
      const eveningSlot = availableSlots.find(slot => {
        const hour = new Date(slot.startTime).getHours();
        return hour >= 17;
      });
      return eveningSlot || availableSlots[0];
    }
    
    return availableSlots[0];
  }
  
  // Check for time references in the message
  for (const slot of availableSlots) {
    const slotTime = new Date(slot.startTime);
    const timeStr = slotTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    }).toLowerCase();
    
    // Check if the time string appears in the user message
    if (userMessage.toLowerCase().includes(timeStr) ||
        // Also check without minutes if it's on the hour
        (slotTime.getMinutes() === 0 && 
         userMessage.toLowerCase().includes(slotTime.getHours() % 12 + ' ' + (slotTime.getHours() >= 12 ? 'pm' : 'am')))
       ) {
      return slot;
    }
  }
  
  // No match found
  return null;
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// UPDATED: Modified to handle scheduling link flow instead of direct booking
async function handleBookingFlow(userMessage, bookingInfo, availableSlots, connectionData) {
  let response = null;
  
  // If we don't have a preferred day yet
  if (!bookingInfo.preferredDay) {
    const dayInfo = handleSchedulingPreference(userMessage);
    
    if (dayInfo) {
      bookingInfo.preferredDay = dayInfo.dayName;
      
      // Get available slots for this day
      const availableSlotsForDay = await getAvailableTimeSlots(dayInfo.date);
      availableSlots.length = 0; // Clear existing slots
      availableSlots.push(...availableSlotsForDay); // Add new slots
      
      // Format response based on available slots
      response = formatAvailableTimeResponse(bookingInfo.preferredDay, availableSlots);
    }
  }
  // If we have a day but no time yet
  else if (!bookingInfo.preferredTime) {
    const selectedSlot = extractTimeFromMessage(userMessage, availableSlots);
    
    if (selectedSlot) {
      // Update booking info
      const slotTime = new Date(selectedSlot.startTime);
      bookingInfo.preferredTime = slotTime.toLocaleTimeString('en-US', {
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      // Update in trigger server
      if (connectionData && connectionData.callId) {
        await updateConversationState(connectionData.callId, true, {
          preferredDay: bookingInfo.preferredDay,
          preferredTime: bookingInfo.preferredTime
        });
      }
      
      response = `Perfect! I'll send you a scheduling link to book for ${bookingInfo.preferredDay} at around ${bookingInfo.preferredTime}. You'll receive this via email shortly, and you can select the exact time that works best for you. Is there anything specific you'd like to discuss during our call?`;
    }
  }
  
  return response;
}

// UPDATED: Modified to send scheduling link instead of confirming direct booking
async function processSchedulingPreference(bookingInfo, connectionData) {
  try {
    // Only proceed if we have enough information
    if (!bookingInfo.email || (!bookingInfo.preferredDay && !bookingInfo.preferredTime)) {
      return {
        success: false,
        message: "I need at least your email and preferred day or time to send you a scheduling link."
      };
    }
    
    const result = await sendSchedulingLinkToEmail(
      bookingInfo.name,
      bookingInfo.email,
      bookingInfo.phone,
      bookingInfo.preferredDay,
      bookingInfo.preferredTime,
      connectionData?.callId
    );
    
    if (result.success) {
      bookingInfo.schedulingLinkSent = true;
      return {
        success: true,
        message: `Perfect! I've sent a scheduling link to your email at ${bookingInfo.email}. The link will allow you to select a time that works best for you on ${bookingInfo.preferredDay}${bookingInfo.preferredTime ? ` around ${bookingInfo.preferredTime}` : ''}. Is there anything else I can help you with today?`
      };
    } else {
      return {
        success: false,
        message: `I'm sorry, there was an issue sending the scheduling link. ${result.message} Would you like to try again?`
      };
    }
  } catch (error) {
    console.error('Error processing scheduling preference:', error);
    return {
      success: false,
      message: "I'm sorry, there was an error sending the scheduling link. Would you like to try again?"
    };
  }
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
  
  // UPDATED: Modified system prompt to reflect scheduling link approach
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella. 
You must sound friendly, relatable, and build rapport naturally. Match their language style. Compliment them genuinely.

IMPORTANT RULES:
- Ask ONE question at a time
- Wait for the user's answer before asking the next question
- Build a back-and-forth conversation, not a checklist
- Acknowledge and respond to user answers briefly to sound human
- Always lead the user towards booking a call with us
- NEVER say "insert name" or any other placeholder text
- NEVER ask for the user's email since we already have it from their form submission
- When discussing dates and times, be specific about actual days and times, not placeholders
- If the user mentions a specific day or time preference, acknowledge it directly and specifically

CONVERSATION FLOW:
1. INTRODUCTION: "Hi, this is Sarah from Nexella. [warm greeting]"
2. DISCOVERY QUESTIONS: Complete all of these before scheduling
   - How did you hear about us?
   - What line of business are you in? What's your business model?
   - What's your main product and typical price point?
   - Are you running ads (Meta, Google, TikTok)?
   - Are you using a CRM like GoHighLevel?
   - What problems are you running into?
3. SCHEDULING: Only after ALL discovery questions are asked
   - First ask what day of the week works best for them
   - When they give you a day or time frame, acknowledge their specific preference
   - For example: "Great! You mentioned next Tuesday afternoon works for you."
   - Be clear that you'll send them a scheduling link via email to pick the exact time
   - Explain that they'll get an email with a Calendly link to choose the specific time slot that works for them
   - DO NOT suggest that you will book the appointment directly
   - Always clarify that they need to use the link to finalize the booking

WHEN DISCUSSING SCHEDULING:
- If user mentions "next week" or any specific timing, acknowledge exactly what they said
- Example: "Perfect, next week on Tuesday would work great. I'll send you a scheduling link to pick a time that works best for you."
- Never use phrases like "insert time" or "insert date" - use the actual times/dates discussed
- Remember we already have their email from their form submission, so just confirm we'll send the scheduling link to that email
- Always make it clear that they need to use the link to select and finalize the exact time that works for them

CALL WRAP-UP:
- Thank them for their time
- Confirm we have their contact details from their initial form
- Tell them they'll receive a scheduling link via email shortly
- No need to ask for email again

Highlight Nexella's features casually throughout the conversation:
- 24/7 SMS and voice AI agents
- Immediate response
- Calendar booking
- CRM integrations
- No Twilio needed
- Caller ID import
- Sales and Customer Support automation
- If they ask if you are AI, tell them yes you are and they would have access to my exact model and other voices to choose from

Your main goal is to complete all discovery questions before scheduling, and make the user feel understood and excited to book a call with Nexella.io using the scheduling link you'll provide.`
    }
  ];

  // States for conversation flow
  let conversationState = 'introduction';  // introduction -> discovery -> booking -> collecting_info
  let bookingInfo = {
    name: '',
    email: '',
    phone: '',
    preferredDay: '',
    preferredTime: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let availableSlots = [];
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
          
          // Check if this is an appointment confirmation call
          if (connectionData.metadata.appointment_time) {
            connectionData.isOutboundCall = true;
            connectionData.isAppointmentConfirmation = true;
            
            // Update system prompt for appointment confirmation
            conversationHistory[0] = {
              role: 'system',
              content: `You are calling from Nexella.io to confirm an appointment.
              
Customer Name: ${connectionData.metadata.customer_name || 'our customer'}
Appointment Time: ${connectionData.metadata.appointment_time || 'the scheduled time'}
              
CALL FLOW:
1. Introduce yourself as Sarah from Nexella.io
2. Confirm you're speaking with the right person
3. Let them know you're calling to confirm their upcoming appointment
4. Confirm their appointment date and time
5. Ask if they have any questions about the appointment
6. Thank them for their time
7. End the call politely

Be friendly, professional, and concise. If they ask to reschedule, tell them they can do so by visiting our website or responding to their confirmation email.`
            };
            
            console.log('Updated system prompt for appointment confirmation call');
          }
          
          // Extract customer info from metadata if available
          if (connectionData.metadata.customer_name) {
            bookingInfo.name = connectionData.metadata.customer_name;
            collectedContactInfo = true;
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

        // Try to handle booking directly if we're in that state
        let directResponse = null;
        
        if (conversationState === 'booking') {
          directResponse = await handleBookingFlow(userMessage, bookingInfo, availableSlots, connectionData);
          
          if (directResponse) {
            ws.send(JSON.stringify({
              content: directResponse,
              content_complete: true,
              actions: [],
              response_id: parsed.response_id
            }));
            return;
          }
        }
        
        // If user indicated they're ready to schedule in any state, we can transition
        if (conversationState === 'discovery' && 
            userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/) &&
            discoveryProgress.questionsAsked.size >= 3) { // At least ask 3 questions before allowing bypass
          
          console.log('User requested scheduling, transitioning to booking state');
          conversationState = 'booking';
          
          // Update conversation state in trigger server
          if (connectionData.callId) {
            updateConversationState(connectionData.callId, true, null);
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
            temperature: 0.5
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );

        const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me a little more about your business?";

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
        
        // Check if we need to send the scheduling link
        if (conversationState === 'booking' && 
            bookingInfo.preferredDay && 
            bookingInfo.preferredTime && 
            !bookingInfo.schedulingLinkSent && 
            collectedContactInfo) {
            
          // If we have necessary info to send scheduling link
          console.log('User has provided scheduling preferences, preparing to send link');
          
          const result = await processSchedulingPreference(bookingInfo, connectionData);
          
          if (result.success) {
            conversationState = 'post_booking';
            ws.send(JSON.stringify({
              content: result.message,
              content_complete: true,
              actions: [],
              response_id: parsed.response_id
            }));
            return;
          }
        }

        // Send the AI response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
        // Check if user has expressed scheduling preferences in their reply
        if (conversationState === 'booking' && botReply.toLowerCase().includes('scheduling link')) {
          // If the AI mentions sending a scheduling link, try to extract/process preferences
          // This ensures we capture the intent even if the direct response handler didn't catch it
          
          // Check if we need to parse preferences from the conversation
          if (!bookingInfo.schedulingLinkSent && collectedContactInfo) {
            // Parse day/time if not already set
            if (!bookingInfo.preferredDay) {
              const dayInfo = handleSchedulingPreference(userMessage);
              if (dayInfo) {
                bookingInfo.preferredDay = dayInfo.dayName;
                console.log('Extracted preferred day from user message:', bookingInfo.preferredDay);
              }
            }
            
            // Only send if we have at least some preference information
            if (bookingInfo.preferredDay || bookingInfo.preferredTime) {
              setTimeout(async () => {
                const result = await processSchedulingPreference(bookingInfo, connectionData);
                if (result.success) {
                  ws.send(JSON.stringify({
                    content: result.message,
                    content_complete: true,
                    actions: [],
                    response_id: 9999 // Use a unique ID
                  }));
                }
              }, 3000); // Wait 3 seconds before sending follow-up
            }
          }
        }
        
        // Clean up when the call is ending
        if (botReply.toLowerCase().includes('goodbye') || 
            botReply.toLowerCase().includes('thank you for your time') ||
            botReply.toLowerCase().includes('have a great day')) {
          
          // If this was an appointment confirmation call, we can clean up
          if (connectionData.callId && connectionData.isAppointmentConfirmation) {
            console.log(`Call ${connectionData.callId} is ending, cleaning up metadata`);
            activeCallsMetadata.delete(connectionData.callId);
          }
        }
      }

    } catch (error) {
      console.error('Error handling message:', error.message);
      ws.send(JSON.stringify({
        content: "I'm sorry, could you say that again please?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });

  ws.on('close', () => {
    console.log('Connection closed.');
    clearTimeout(autoGreetingTimer); // Clear the timer when connection closes
    
    // Clean up any stored data for this connection
    if (connectionData.callId) {
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
        
        // If this was an appointment confirmation call, you could log or store the result
        if (call.metadata && call.metadata.appointment_id) {
          console.log(`Appointment confirmation call ended for appointment: ${call.metadata.appointment_id}`);
          // Here you could update your database or trigger follow-up actions
        }
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
