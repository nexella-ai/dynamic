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

// For sending booking request to trigger server
async function scheduleCall(name, email, phone, startTime, endTime, userId) {
  try {
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/trigger-call`, {
      name, email, phone, startTime, endTime, userId
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
    // Format date as YYYY-MM-DD for the API
    const formattedDate = new Date(date).toISOString().split('T')[0];
    
    const response = await axios.get(`${process.env.TRIGGER_SERVER_URL}/available-slots`, {
      params: { date: formattedDate }
    });
    
    return response.data.availableSlots;
  } catch (error) {
    console.error('Error getting available slots:', error.message);
    return [];
  }
}

wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');

  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io. 
You must sound friendly, relatable, and build rapport naturally. Match their language style. Compliment them genuinely.

IMPORTANT:
- Ask ONE question at a time.
- Wait for the user's answer before asking the next question.
- Build a back-and-forth conversation, not a checklist.
- Acknowledge and respond to user answers briefly to sound human.
- Always lead the user towards booking a call with us.

DISCOVERY QUESTIONS:
- How did you hear about us?
- What line of business are you in? What's your business model?
- What's your main product and typical price point?
- Are you running ads (Meta, Google, TikTok)?
- Are you using a CRM like GoHighLevel?
- What problems are you running into?

When they mention a problem, reassure them that Nexella can help.

Highlight Nexella's features casually throughout the conversation:
- 24/7 SMS and voice AI agents
- Immediate response
- Calendar booking
- CRM integrations
- No Twilio needed
- Caller ID import
- Sales and Customer Support automation

CALENDLY BOOKING:
After going through the discovery questions, guide the user to book a call:
1. First ask what day of the week works best for them
2. Then suggest available time slots for that day (use the available slots API)
3. Allow them to pick a time or suggest another day
4. Confirm the booking details before sending

Your main goal is to make the user feel understood and excited to book a call with Nexella.io.`
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

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('User said:', userMessage);
        console.log('Current conversation state:', conversationState);

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
                      bookingInfo.userId
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
            
            // Schedule the call with our trigger server
            const result = await scheduleCall(
              bookingInfo.name,
              bookingInfo.email,
              bookingInfo.phone,
              bookingInfo.startTime,
              bookingInfo.endTime,
              bookingInfo.userId
            );
            
            if (result.success) {
              bookingInfo.confirmed = true;
              
              // Also send to make.com
              try {
                await axios.post('https://hook.us2.make.com/6wsdtorhmrpxbical1czq09pmurffoei', {
                  name: bookingInfo.name,
                  email: bookingInfo.email,
                  phone: bookingInfo.phone,
                  appointmentDate: bookingInfo.preferredDay,
                  appointmentTime: bookingInfo.preferredTime
                });
              } catch (makeError) {
                console.error('Error sending to make.com:', makeError.message);
              }
              
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

        // Check if it's time to transition to booking flow based on the content
        if (conversationState === 'introduction' || conversationState === 'discovery') {
          if (botReply.toLowerCase().includes('what problems are you running into') ||
              botReply.toLowerCase().includes('what day works')) {
            // Time to transition to booking flow
            conversationState = 'booking';
          }
        }

        // Send the response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));

        // If we're still in discovery mode and coming to the end of discovery questions
        if (conversationState === 'discovery' && 
            botReply.toLowerCase().includes('what problems are you running into')) {
          // Wait a bit before transitioning to booking
          setTimeout(() => {
            conversationState = 'booking';
            ws.send(JSON.stringify({
              content: "Based on what you've shared, I think our team would love to discuss how Nexella can help you. What day of the week would work best for a quick call?",
              content_complete: true,
              actions: []
            }));
          }, 5000);
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
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server with Calendly integration is listening on port ${PORT}`);
});
