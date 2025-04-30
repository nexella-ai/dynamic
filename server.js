require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with memory and Calendly integration is live!');
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

// For locking a slot temporarily
async function lockSlot(startTime, endTime, userId) {
  try {
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/lock-slot`, {
      startTime, endTime, userId
    });
    return response.data.success;
  } catch (error) {
    console.error('Error locking slot:', error.message);
    return false;
  }
}

// For scheduling a call with our trigger server - Updated to use schedule-calendly endpoint
async function scheduleCall(name, email, phone, startTime, endTime, userId, callId) {
  try {
    // Use the new schedule-calendly endpoint instead of trigger-call
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/schedule-calendly`, {
      name,
      email,
      phone,
      startTime,
      endTime,
      userId,
      call_id: callId, // Pass the call_id to associate the scheduling with the call
      eventTypeUri: process.env.CALENDLY_EVENT_TYPE_URI
    });
    return { success: response.data.success, message: response.data.message };
  } catch (error) {
    console.error('Error scheduling call:', error.response?.data || error.message);
    return { success: false, message: 'Failed to schedule the call. Please try again.' };
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
  
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io. 
You must sound friendly, relatable, and build rapport naturally. Match their language style. Compliment them genuinely.

IMPORTANT CONVERSATION FLOW:
1. INTRODUCTION: Introduce yourself warmly and establish rapport
2. DISCOVERY: You MUST complete ALL discovery questions before moving to scheduling
3. SCHEDULING: Only after ALL discovery questions are complete, move to scheduling

DISCOVERY QUESTIONS (ask in this order):
- How did you hear about us?
- What line of business are you in? What's your business model?
- What's your main product and typical price point?
- Are you running ads (Meta, Google, TikTok)?
- Are you using a CRM like GoHighLevel?
- What problems are you running into?

RULES FOR DISCOVERY:
- Ask ONE question at a time
- Wait for the user's answer before asking the next question
- Acknowledge each answer briefly before moving to the next question
- Do NOT mention scheduling or booking until ALL discovery questions have been asked
- Never skip any discovery questions

When customers mention problems, reassure them that Nexella can help solve these issues.

TRANSITION TO SCHEDULING:
Only after you've asked ALL six discovery questions and received answers, you can transition by saying something like:
"Based on what you've shared, I think our team would love to discuss how Nexella can help you with [mention their specific problems]. What day of the week would work best for a quick call?"

SCHEDULING RULES:
1. First ask what day of the week works best for them
2. Then suggest available time slots for that day
3. Allow them to pick a time or suggest another day
4. Confirm the booking details before sending

Highlight Nexella's features naturally throughout the conversation:
- 24/7 SMS and voice AI agents
- Immediate response
- Calendar booking
- CRM integrations
- No Twilio needed
- Caller ID import
- Sales and Customer Support automation

Your main goal is to complete all discovery questions before scheduling, and make the user feel understood and excited to book a call with Nexella.io.`
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
    startTime: '',
    endTime: '',
    slotLocked: false,
    confirmed: false,
    userId: `user_${Date.now()}`
  };
  let availableSlots = [];
  let collectedContactInfo = false;

  // Initial greeting
  ws.send(JSON.stringify({
    content: "connecting...",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  setTimeout(() => {
    ws.send(JSON.stringify({
      content: "Hi there! Thank you for calling Nexella AI. How are you doing today?",
      content_complete: true,
      actions: [],
      response_id: 1
    }));
  }, 500);

  ws.on('message', async (data) => {
    try {
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
1. Introduce yourself as calling from Nexella.io
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
          }
          if (connectionData.metadata.customer_email) {
            bookingInfo.email = connectionData.metadata.customer_email;
          }
          if (connectionData.metadata.phone) {
            bookingInfo.phone = connectionData.metadata.phone;
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

        // Track which discovery questions have been asked
        function checkForDiscoveryQuestionsInLastResponse() {
          if (conversationHistory.length >= 2) {
            const lastBotMessage = conversationHistory[conversationHistory.length - 2].content.toLowerCase();
            
            discoveryQuestions.forEach((question, index) => {
              // Check if the question or a paraphrase of it appears in the bot's message
              const questionLower = question.toLowerCase();
              const keyPhrases = [
                "how did you hear",
                "business are you in",
                "main product",
                "price point",
                "running ads",
                "using a crm",
                "problems are you"
              ];
              
              if (lastBotMessage.includes(keyPhrases[index])) {
                discoveryProgress.questionsAsked.add(index);
              }
            });
            
            // Check if all questions have been asked
            discoveryProgress.allQuestionsAsked = discoveryProgress.questionsAsked.size >= discoveryQuestions.length;
            
            if (discoveryProgress.allQuestionsAsked && conversationState === 'discovery') {
              console.log('✅ All discovery questions have been asked, transitioning to booking');
              conversationState = 'booking';
              
              // Update conversation state in trigger server
              if (connectionData.callId) {
                updateConversationState(connectionData.callId, true, null);
              }
            }
          }
        }
        
        // Check if the last bot response contained a discovery question
        checkForDiscoveryQuestionsInLastResponse();

        // Handle booking flow
        if (conversationState === 'booking') {
          // If we're collecting preferred day
          if (!bookingInfo.preferredDay) {
            // Extract day of week from user message
            const dayMatch = userMessage.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i);
            if (dayMatch) {
              bookingInfo.preferredDay = dayMatch[0];
              
              // Get available slots for this day
              const today = new Date();
              let targetDate = new Date();
              
              // Find the next occurrence of the requested day
              const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
              const requestedDayIndex = daysOfWeek.findIndex(d => d === bookingInfo.preferredDay.toLowerCase());
              
              while (targetDate.getDay() !== requestedDayIndex) {
                targetDate.setDate(targetDate.getDate() + 1);
              }
              
              // Get available slots
              availableSlots = await getAvailableTimeSlots(targetDate);
              
              let reply;
              if (availableSlots.length > 0) {
                // Format slots for natural language (show max 3)
                const slotsToShow = availableSlots.slice(0, 3);
                const formattedSlots = slotsToShow.map(slot => {
                  const time = new Date(slot.startTime).toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    hour12: true 
                  });
                  return time;
                }).join(', ');
                
                reply = `Great! For ${bookingInfo.preferredDay}, I have availability at ${formattedSlots}. Would any of these times work for you?`;
              } else {
                reply = `I'm sorry, it looks like we don't have any available slots for ${bookingInfo.preferredDay}. Would you like to try another day?`;
                bookingInfo.preferredDay = '';
              }
              
              ws.send(JSON.stringify({
                content: reply,
                content_complete: true,
                actions: [],
                response_id: parsed.response_id
              }));
              return;
            }
          }
          // If we're collecting preferred time
          else if (!bookingInfo.preferredTime) {
            // Try to extract time from user message
            const timeRegex = /(\d{1,2})(:\d{2})?\s*(am|pm)?/i;
            const timeMatch = userMessage.match(timeRegex);
            
            if (timeMatch || userMessage.toLowerCase().includes('yes') || 
                availableSlots.some(slot => {
                  const time = new Date(slot.startTime).toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', hour12: true
                  });
                  return userMessage.toLowerCase().includes(time.toLowerCase());
                })) {
              
              // Find the matching slot
              let selectedSlot;
              
              if (timeMatch) {
                // Convert user's time to 24-hour format for comparison
                const hour = parseInt(timeMatch[1]);
                const minute = timeMatch[2] ? parseInt(timeMatch[2].substring(1)) : 0;
                const isPM = timeMatch[3]?.toLowerCase() === 'pm';
                
                // Convert to 24-hour format
                const hour24 = isPM && hour < 12 ? hour + 12 : (!isPM && hour === 12 ? 0 : hour);
                
                // Find closest slot
                selectedSlot = availableSlots.find(slot => {
                  const slotTime = new Date(slot.startTime);
                  return slotTime.getHours() === hour24 && 
                         (minute === 0 || slotTime.getMinutes() === minute);
                });
              } else if (userMessage.toLowerCase().includes('yes')) {
                // User said yes to one of our suggestions, so select the first slot
                selectedSlot = availableSlots[0];
              } else {
                // Try to match one of our suggested slots
                for (const slot of availableSlots) {
                  const time = new Date(slot.startTime).toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', hour12: true
                  });
                  if (userMessage.toLowerCase().includes(time.toLowerCase())) {
                    selectedSlot = slot;
                    break;
                  }
                }
              }
              
              if (selectedSlot) {
                // Lock the slot temporarily
                const locked = await lockSlot(
                  selectedSlot.startTime, 
                  selectedSlot.endTime, 
                  bookingInfo.userId
                );
                
                if (locked) {
                  bookingInfo.preferredTime = new Date(selectedSlot.startTime).toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', hour12: true
                  });
                  bookingInfo.startTime = selectedSlot.startTime;
                  bookingInfo.endTime = selectedSlot.endTime;
                  bookingInfo.slotLocked = true;
                  
                  // Update selected slot in trigger server
                  if (connectionData.callId) {
                    updateConversationState(connectionData.callId, true, {
                      startTime: selectedSlot.startTime,
                      endTime: selectedSlot.endTime
                    });
                  }
                  
                  // Move to collecting contact info if not done already
                  if (!collectedContactInfo) {
                    conversationState = 'collecting_info';
                    ws.send(JSON.stringify({
                      content: `Perfect! I've reserved ${bookingInfo.preferredDay} at ${bookingInfo.preferredTime} for you. To confirm this booking, may I have your full name?`,
                      content_complete: true,
                      actions: [],
                      response_id: parsed.response_id
                    }));
                    return;
                  } else {
                    // If we already have contact info, confirm booking
                    const result = await scheduleCall(
                      bookingInfo.name,
                      bookingInfo.email,
                      bookingInfo.phone,
                      bookingInfo.startTime,
                      bookingInfo.endTime,
                      bookingInfo.userId,
                      connectionData.callId // Pass the call ID to associate with scheduling
                    );
                    
                    if (result.success) {
                      bookingInfo.confirmed = true;
                      ws.send(JSON.stringify({
                        content: `Excellent! Your call has been scheduled for ${bookingInfo.preferredDay} at ${bookingInfo.preferredTime}. You'll receive a confirmation email shortly. Is there anything else I can help you with today?`,
                        content_complete: true,
                        actions: [],
                        response_id: parsed.response_id
                      }));
                    } else {
                      ws.send(JSON.stringify({
                        content: `I'm sorry, there was an issue scheduling your call. ${result.message} Would you like to try another time?`,
                        content_complete: true,
                        actions: [],
                        response_id: parsed.response_id
                      }));
                      bookingInfo.preferredTime = '';
                      bookingInfo.slotLocked = false;
                    }
                    return;
                  }
                } else {
                  ws.send(JSON.stringify({
                    content: "I'm sorry, that time slot is no longer available. Let me check what else we have available.",
                    content_complete: true,
                    actions: [],
                    response_id: parsed.response_id
                  }));
                  bookingInfo.preferredTime = '';
                  return;
                }
              } else {
                ws.send(JSON.stringify({
                  content: "I'm sorry, I couldn't find that exact time in our availability. Could you pick one of the time slots I mentioned earlier?",
                  content_complete: true,
                  actions: [],
                  response_id: parsed.response_id
                }));
                return;
              }
            }
          }
        }
        // Handle collecting contact info state
        else if (conversationState === 'collecting_info') {
          if (!bookingInfo.name) {
            bookingInfo.name = userMessage;
            ws.send(JSON.stringify({
              content: `Thanks ${bookingInfo.name}! What's the best email address to reach you?`,
              content_complete: true,
              actions: [],
              response_id: parsed.response_id
            }));
            return;
          } else if (!bookingInfo.email && userMessage.includes('@')) {
            bookingInfo.email = userMessage;
            ws.send(JSON.stringify({
              content: "Got it, and what's your best phone number?",
              content_complete: true,
              actions: [],
              response_id: parsed.response_id
            }));
            return;
          } else if (!bookingInfo.phone && userMessage.match(/\d{3}[-\s]?\d{3}[-\s]?\d{4}/)) {
            bookingInfo.phone = userMessage;
            collectedContactInfo = true;
            
            // Schedule the call with our trigger server using the new endpoint
            const result = await scheduleCall(
              bookingInfo.name,
              bookingInfo.email,
              bookingInfo.phone,
              bookingInfo.startTime,
              bookingInfo.endTime,
              bookingInfo.userId,
              connectionData.callId // Pass the call ID for association
            );
            
            if (result.success) {
              bookingInfo.confirmed = true;
              
              ws.send(JSON.stringify({
                content: `Perfect! I've scheduled your call for ${bookingInfo.preferredDay} at ${bookingInfo.preferredTime}. You'll receive a confirmation email shortly with all the details. Is there anything else I can help you with today?`,
                content_complete: true,
                actions: [],
                response_id: parsed.response_id
              }));
              
              // Reset to standard conversation
              conversationState = 'post_booking';
            } else {
              ws.send(JSON.stringify({
                content: `I'm sorry, there was an issue scheduling your call. ${result.message} Would you like to try another time?`,
                content_complete: true,
                actions: [],
                response_id: parsed.response_id
              }));
              // Reset booking time
              bookingInfo.preferredTime = '';
              bookingInfo.slotLocked = false;
              conversationState = 'booking';
            }
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

        // Analyze bot reply to track state transitions
        const containsProblemQuestion = botReply.toLowerCase().includes('what problems are you') || 
                                        botReply.toLowerCase().includes('what challenges do you face');
        const containsSchedulingQuestion = botReply.toLowerCase().includes('what day works') || 
                                         botReply.toLowerCase().includes('day of the week would');
        
        // Transition state based on content
        if (conversationState === 'introduction') {
          // Move to discovery after introduction
          conversationState = 'discovery';
        } else if (conversationState === 'discovery' && containsSchedulingQuestion) {
          // Only transition to booking if explicitly talking about scheduling days
          conversationState = 'booking';
          
          // Mark discovery as complete in the trigger server
          if (connectionData.callId) {
            updateConversationState(connectionData.callId, true, null);
          }
        }

        // Send the response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
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

        // If we're in discovery mode and just asked the last discovery question
        if (conversationState === 'discovery' && containsProblemQuestion) {
          discoveryProgress.questionsAsked.add(discoveryQuestions.length - 1); // Mark the last question as asked
          
          // Let bot response complete, then transition only after user's next reply
          // This ensures the user has a chance to answer the final discovery question
          console.log('Last discovery question asked, will transition to booking after user response');
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
  console.log(`Nexella WebSocket Server with Calendly integration is listening on port ${PORT}`);
});
