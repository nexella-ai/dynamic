// src/handlers/WebSocketHandler.js - FIXED VERSION WITH AUTO-BOOKING
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  checkAvailability, 
  generateAvailabilityResponse, 
  handleSchedulingPreference,
  suggestAlternativeTime,
  getAvailableTimeSlots,
  autoBookAppointment
} = require('../services/calendar/CalendarHelpers');
const { 
  sendSchedulingPreference, 
  addCallMetadata, 
  removeCallMetadata 
} = require('../services/webhooks/WebhookService');

class WebSocketHandler {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    console.log('🔗 NEW CONNECTION - Call ID:', this.callId);
    
    this.connectionData = {
      callId: this.callId,
      customerEmail: 'customer@example.com', // Default for testing
      customerName: 'Test Customer',
      customerPhone: '+1234567890'
    };
    
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a friendly and professional AI assistant.

DISCOVERY QUESTIONS (ask in this EXACT order, ONE AT A TIME):
1. "How did you hear about us?"
2. "What industry or business are you in?" 
3. "What's your main product or service?"
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

CRITICAL RULES:
- Always start with a friendly greeting: "Hi there! This is Sarah from Nexella AI. How are you doing today?"
- BEFORE asking any question, CHECK if it was already asked
- Do NOT repeat questions you've already asked
- Ask questions naturally, acknowledge their previous answer first
- When user asks about scheduling after 4+ questions, provide real availability
- When user gives specific time, confirm the booking

SCHEDULING BEHAVIOR:
- If user requests specific day/time and 4+ discovery questions are complete, book the appointment
- Always confirm booking details clearly
- Be helpful and accommodating`
      }
    ];
    
    this.userHasSpoken = false;
    this.webhookSent = false;
    this.lastBotMessage = '';
    this.questionAskedTimestamp = 0;
    this.pendingBooking = null;
    
    this.initialize();
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  async initialize() {
    this.initializeDiscoverySession();
    this.setupEventHandlers();
    this.sendInitialGreeting();
  }

  initializeDiscoverySession() {
    const session = globalDiscoveryManager.getSession(this.callId, this.connectionData);
    
    console.log(`📊 SESSION STATUS - Call ID: ${this.callId}`);
    console.log(`📊 Questions: ${session.progress.questionsCompleted}/6`);
    console.log(`📊 Scheduling: ${session.progress.schedulingStarted ? 'STARTED' : 'NOT_STARTED'}`);
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  sendInitialGreeting() {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    setTimeout(() => {
      if (!this.userHasSpoken) {
        if (!progress || progress.questionsCompleted === 0) {
          console.log('🎙️ Sending NEW greeting');
          this.sendResponse("Hi there! This is Sarah from Nexella AI. How are you doing today?", 1);
        } else {
          console.log('🎙️ Sending RESUME greeting');
          this.sendResponse("Welcome back! Let's continue our conversation.", 1);
        }
      }
    }, 2000); // Reduced delay
  }

  sendResponse(content, responseId = null) {
    this.lastBotMessage = content;
    this.questionAskedTimestamp = Date.now();
    
    console.log('🤖 SENT:', content.substring(0, 80) + '...');
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId || Date.now()
    }));
  }

  async handleMessage(data) {
    try {
      this.userHasSpoken = true;
      const parsed = JSON.parse(data);
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log(`🗣️ USER: "${userMessage}"`);
    
    // Get current progress
    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log(`📊 CURRENT: ${progress?.questionsCompleted}/6 questions, scheduling=${progress?.schedulingStarted}`);

    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // FIXED: Check for specific time booking request
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    
    if (specificTimeMatch && progress?.questionsCompleted >= 4) {
      console.log('🕐 SPECIFIC TIME DETECTED:', specificTimeMatch);
      await this.handleSpecificTimeBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // Check for general availability request
    const isAvailabilityRequest = /what times|when are you|when do you|available|schedule|appointment|book|meet/i.test(userMessage);
    
    if (isAvailabilityRequest && progress?.questionsCompleted >= 4) {
      console.log('🗓️ ✅ SWITCHING TO SCHEDULING MODE');
      
      globalDiscoveryManager.markSchedulingStarted(this.callId);
      
      try {
        const availabilityResponse = await generateAvailabilityResponse();
        const response = `Perfect! I have all the information I need. ${availabilityResponse}`;
        
        console.log('🗓️ ✅ SENT SCHEDULING RESPONSE');
        
        this.conversationHistory.push({ role: 'assistant', content: response });
        this.sendResponse(response, parsed.response_id);
        return;
      } catch (error) {
        console.log('🗓️ ⚠️ FALLBACK SCHEDULING RESPONSE');
        const fallbackResponse = "Perfect! Let me check my calendar. I have availability Monday through Friday from 9 AM to 5 PM. What day and time would work best for you?";
        
        this.conversationHistory.push({ role: 'assistant', content: fallbackResponse });
        this.sendResponse(fallbackResponse, parsed.response_id);
        return;
      }
    }

    // Handle discovery process
    await this.handleDiscoveryProcess(userMessage, parsed.response_id);
  }

  detectSpecificTimeRequest(userMessage) {
    // FIXED: Better time detection patterns
    const patterns = [
      // Day with time: "monday at 2pm", "tuesday 10am"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)/i,
      // Time with day: "2pm monday", "10am tomorrow"
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
      // Just time if in scheduling mode: "2pm", "10am"
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)\b/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = userMessage.match(patterns[i]);
      if (match) {
        console.log('🕐 Time pattern matched:', match);
        
        let day, hour, minutes, period;
        
        if (i === 0) { // Day first pattern
          day = match[1];
          hour = parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
        } else if (i === 1) { // Time first pattern
          hour = parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = match[4];
        } else { // Just time pattern
          hour = parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = 'today'; // Default
        }

        return this.parseDateTime(day, hour, minutes, period);
      }
    }

    return null;
  }

  parseDateTime(day, hour, minutes, period) {
    let targetDate = new Date();
    
    // Parse day
    if (day === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (day === 'today') {
      // Keep today
    } else {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = daysOfWeek.indexOf(day.toLowerCase());
      if (dayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = dayIndex - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7; // Next week
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    // Parse time
    if (period.toLowerCase().includes('p') && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase().includes('a') && hour === 12) {
      hour = 0;
    }
    
    targetDate.setHours(hour, minutes, 0, 0);
    
    return {
      dateTime: targetDate,
      dayName: day,
      timeString: `${hour > 12 ? hour - 12 : hour === 0 ? 12 : hour}:${minutes.toString().padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
    };
  }

  async handleSpecificTimeBooking(timeRequest, responseId) {
    try {
      console.log('🔄 Attempting specific time booking:', timeRequest);
      
      // Get discovery data
      const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
      
      console.log('👤 Customer info:', this.connectionData);
      console.log('📝 Discovery data:', discoveryData);
      
      const bookingResult = await autoBookAppointment(
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        timeRequest.dateTime,
        discoveryData
      );
      
      let response;
      
      if (bookingResult.success) {
        console.log('✅ AUTO-BOOKING SUCCESS!');
        
        response = `Perfect! I've successfully booked your consultation for ${timeRequest.dayName} at ${timeRequest.timeString}. `;
        
        if (bookingResult.meetingLink && !bookingResult.isDemo) {
          response += `You can join the call using this link: ${bookingResult.meetingLink}. `;
        }
        
        if (!bookingResult.isDemo) {
          response += "You'll also receive a calendar invitation with all the details. ";
        } else {
          response += "This is a demo booking - add Google Calendar credentials for real appointments. ";
        }
        
        response += "Looking forward to speaking with you!";
        
        // Send webhook notification
        try {
          await sendSchedulingPreference(
            this.connectionData.customerName,
            this.connectionData.customerEmail,
            this.connectionData.customerPhone,
            `${timeRequest.dayName} at ${timeRequest.timeString}`,
            this.callId,
            discoveryData
          );
          console.log('✅ Webhook sent for successful booking');
        } catch (webhookError) {
          console.error('❌ Webhook error:', webhookError.message);
        }
        
      } else {
        console.log('❌ AUTO-BOOKING FAILED:', bookingResult.error);
        
        try {
          const alternativeResponse = await suggestAlternativeTime(timeRequest.dateTime.toDateString(), '');
          response = `I'm sorry, that time slot isn't available. ${alternativeResponse}`;
        } catch (altError) {
          response = "I'm sorry, that time slot isn't available. Let me check what other times I have available this week.";
        }
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      this.sendResponse(response, responseId);
      
    } catch (error) {
      console.error('❌ Specific time booking error:', error.message);
      
      const errorResponse = "I had trouble booking that specific time. Let me check what availability I have and suggest some options.";
      this.conversationHistory.push({ role: 'assistant', content: errorResponse });
      this.sendResponse(errorResponse, responseId);
    }
  }

  async handleDiscoveryProcess(userMessage, responseId) {
    console.log('📝 PROCESSING AS DISCOVERY');

    // Generate response with discovery context
    const contextPrompt = this.generateContextPrompt();
    const botReply = await this.getAIResponse(contextPrompt);
    
    console.log(`🤖 REPLY: "${botReply.substring(0, 80)}..."`);
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Check for discovery question in bot reply
    const questionDetected = globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);
    console.log(`🔍 Question detected in bot reply: ${questionDetected}`);

    // FIXED: Better answer capture logic
    const progress = globalDiscoveryManager.getProgress(this.callId);
    if (progress?.waitingForAnswer && progress?.currentQuestionIndex >= 0) {
      // Only capture if the user message is actually answering the question
      if (!this.isSchedulingRequest(userMessage)) {
        const captured = globalDiscoveryManager.captureAnswer(
          this.callId, 
          progress.currentQuestionIndex, 
          userMessage.trim()
        );
        console.log(`📝 Answer captured: ${captured}`);
        
        if (captured) {
          const newProgress = globalDiscoveryManager.getProgress(this.callId);
          console.log(`📊 NEW PROGRESS: ${newProgress?.questionsCompleted}/6 questions`);
          
          // If all questions are done, hint at scheduling
          if (newProgress?.questionsCompleted === 6 && !newProgress?.schedulingStarted) {
            const schedulingHint = " Perfect! I have all the information I need. Would you like to schedule a consultation to discuss how we can help you with these challenges?";
            this.conversationHistory[this.conversationHistory.length - 1].content += schedulingHint;
            this.sendResponse(botReply + schedulingHint, responseId);
            return;
          }
        }
      }
    }

    this.sendResponse(botReply, responseId);
  }

  isSchedulingRequest(userMessage) {
    const schedulingKeywords = [
      'schedule', 'book', 'appointment', 'call', 'talk', 'meet',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
      'available', 'times', 'when', 'am', 'pm'
    ];
    
    const userLower = userMessage.toLowerCase();
    return schedulingKeywords.some(keyword => userLower.includes(keyword));
  }

  generateContextPrompt() {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    if (!progress) {
      return '\n\nCONTEXT: This is a new conversation. Start with discovery questions.';
    }

    if (progress.schedulingStarted) {
      return '\n\nCONTEXT: You are in scheduling mode. Help with booking appointments.';
    }

    if (progress.questionsCompleted < 6) {
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        const questionNumber = progress.questionsCompleted + 1;
        return `\n\nCONTEXT: Continue discovery conversation. You need to ask: "${nextQuestion.question}" (Question ${questionNumber}/6). Ask it naturally after acknowledging their previous answer.`;
      }
    }

    return '\n\nCONTEXT: Discovery is complete (6/6 questions answered). Offer to schedule a consultation.';
  }

  async getAIResponse(contextPrompt) {
    const messages = [...this.conversationHistory];
    if (contextPrompt) {
      messages[messages.length - 1].content += contextPrompt;
    }

    try {
      const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: messages,
        temperature: 0.7,
        max_tokens: 150
      }, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });

      return openaiResponse.data.choices[0].message.content || "Could you tell me more about that?";
    } catch (error) {
      console.error('❌ OpenAI error:', error.message);
      return "I'm having trouble processing that. Could you repeat it?";
    }
  }

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED');
    
    // Send final webhook if discovery was completed but no booking was made
    const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    if (sessionInfo && progress?.questionsCompleted > 0 && !this.webhookSent) {
      console.log('💾 Sending final webhook on connection close');
      
      try {
        const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
        
        await sendSchedulingPreference(
          this.connectionData.customerName,
          this.connectionData.customerEmail,
          this.connectionData.customerPhone,
          'Call ended before scheduling',
          this.callId,
          discoveryData
        );
        
        this.webhookSent = true;
        console.log('✅ Final webhook sent successfully');
      } catch (error) {
        console.error('❌ Error sending final webhook:', error.message);
      }
    }
    
    if (sessionInfo) {
      console.log(`💾 SESSION PRESERVED: ${sessionInfo.questionsCompleted}/6 questions completed`);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error);
  }
}

module.exports = WebSocketHandler;
