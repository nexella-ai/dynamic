// src/handlers/WebSocketHandler.js - CONTEXTUAL VERSION WITH BOOKING
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
      customerEmail: 'customer@example.com',
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

CONVERSATION STYLE:
- Be naturally conversational and engaging
- Give contextual responses that acknowledge their specific answers
- For Instagram: "Instagram, nice! Social media is huge these days."
- For Solar: "Solar industry, that's awesome! Clean energy is the future."
- For Healthcare: "Healthcare, wonderful! Such important work."
- Keep responses warm but concise (2-3 sentences max)
- Always acknowledge their answer, then ask the next question

BOOKING BEHAVIOR:
- When user gives specific time like "Monday at 10 AM" or "Can do Monday at ten AM", immediately confirm booking
- Say: "Perfect! I've booked your consultation for [day] at [time]. You'll receive a calendar invitation shortly!"

CRITICAL: Always respond naturally and conversationally, but detect booking requests accurately.`
      }
    ];
    
    this.userHasSpoken = false;
    this.webhookSent = false;
    this.hasGreeted = false;
    
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
    console.log(`📊 SESSION: ${session.progress.questionsCompleted}/6 questions`);
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  sendInitialGreeting() {
    if (!this.hasGreeted) {
      this.hasGreeted = true;
      console.log('🎙️ Sending immediate greeting');
      this.sendResponse("Hi there! This is Sarah from Nexella AI. How are you doing today?", 1);
    }
  }

  sendResponse(content, responseId = null) {
    console.log('🤖 SENT:', content.substring(0, 50) + '...');
    
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
    
    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log(`📊 PROGRESS: ${progress?.questionsCompleted}/6 questions`);

    this.conversationHistory.push({ role: 'user', content: userMessage });

    // PRIORITY 1: Check for specific time booking request FIRST
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    
    if (specificTimeMatch) {
      console.log('🕐 BOOKING TIME DETECTED:', specificTimeMatch.timeString);
      await this.handleSpecificTimeBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // PRIORITY 2: Check for general availability request
    const isAvailabilityRequest = /what times|when are you|available|schedule|appointment|book|meet/i.test(userMessage) && 
                                 !/monday|tuesday|wednesday|thursday|friday/i.test(userMessage);
    
    if (isAvailabilityRequest) {
      console.log('🗓️ SHOWING AVAILABILITY');
      const quickResponse = "I have availability Monday through Friday from 9 AM to 5 PM Arizona time. What day and time works best for you?";
      
      this.conversationHistory.push({ role: 'assistant', content: quickResponse });
      this.sendResponse(quickResponse, parsed.response_id);
      return;
    }

    // PRIORITY 3: Handle discovery process with contextual responses
    await this.handleDiscoveryProcess(userMessage, parsed.response_id);
  }

  detectSpecificTimeRequest(userMessage) {
    // ENHANCED: More comprehensive booking detection
    const patterns = [
      // "Monday at 10 AM", "tuesday 2pm", etc.
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "10 AM Monday", "2pm tuesday", etc.  
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
      // "Can do Monday at 10", "Monday 10am works", "Yes Monday at 10"
      /(?:can do|works?|good|yes|ok|okay|sure|perfect|sounds good).*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "Monday at ten", "tuesday ten am" (word numbers)
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)\s*(am|pm)/i,
      // "Can do Monday at ten AM"
      /(?:can do|works?|good|yes|ok|okay).*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)\s*(am|pm)/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = userMessage.match(patterns[i]);
      if (match) {
        console.log('🕐 Time pattern matched:', match);
        
        let day, hour, minutes, period;
        
        if (i === 0) { // Day first
          day = match[1];
          hour = parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
        } else if (i === 1) { // Time first
          hour = parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = match[4];
        } else if (i === 2) { // "Can do Monday at 10"
          day = match[1];
          hour = parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
        } else if (i === 3 || i === 4) { // Word numbers
          day = match[1];
          const timeWords = {
            'ten': 10, 'eleven': 11, 'twelve': 12, 'one': 1, 'two': 2, 
            'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 
            'eight': 8, 'nine': 9
          };
          hour = timeWords[match[2]] || 10;
          minutes = 0;
          period = match[3];
        }

        return this.parseDateTime(day, hour, minutes, period);
      }
    }
    return null;
  }

  parseDateTime(day, hour, minutes, period) {
    let targetDate = new Date();
    
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
        if (daysToAdd <= 0) daysToAdd += 7;
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
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
      console.log('🔄 ATTEMPTING BOOKING:', timeRequest.timeString);
      
      const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
      
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
        response = `Perfect! I've booked your consultation for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive a calendar invitation shortly!`;
        
        // Send webhook in background
        this.sendWebhookInBackground(timeRequest, discoveryData);
        
      } else {
        console.log('❌ AUTO-BOOKING FAILED:', bookingResult.error);
        response = `Excellent! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
        
        // Send webhook anyway for manual follow-up
        this.sendWebhookInBackground(timeRequest, discoveryData);
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      this.sendResponse(response, responseId);
      
    } catch (error) {
      console.error('❌ Booking error:', error.message);
      const errorResponse = `Great! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
      this.sendResponse(errorResponse, responseId);
    }
  }

  async sendWebhookInBackground(timeRequest, discoveryData) {
    setTimeout(async () => {
      try {
        await sendSchedulingPreference(
          this.connectionData.customerName,
          this.connectionData.customerEmail,
          this.connectionData.customerPhone,
          `${timeRequest.dayName} at ${timeRequest.timeString}`,
          this.callId,
          discoveryData
        );
        console.log('✅ Background webhook sent');
      } catch (error) {
        console.error('❌ Background webhook error:', error.message);
      }
    }, 100);
  }

  async handleDiscoveryProcess(userMessage, responseId) {
    console.log('📝 DISCOVERY PROCESS');

    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // Capture answer if waiting for one
    if (progress?.waitingForAnswer && !this.isSchedulingRequest(userMessage)) {
      const captured = globalDiscoveryManager.captureAnswer(
        this.callId, 
        progress.currentQuestionIndex, 
        userMessage.trim()
      );
      console.log(`📝 Answer captured: ${captured}`);
    }

    // KEEP: Generate contextual AI response (the natural conversation style you liked)
    const botReply = await this.getContextualAIResponse();
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Check for question detection
    globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);

    this.sendResponse(botReply, responseId);
  }

  async getContextualAIResponse() {
    // KEEP: Use full AI response for natural, contextual conversation
    const messages = [...this.conversationHistory];
    
    // Add discovery context
    const progress = globalDiscoveryManager.getProgress(this.callId);
    if (progress && progress.questionsCompleted < 6) {
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        const contextPrompt = `\n\nCONTEXT: Continue discovery conversation. You need to ask: "${nextQuestion.question}" (Question ${progress.questionsCompleted + 1}/6). Give a natural, contextual response that acknowledges their previous answer, then ask the next question. Keep it conversational and engaging.`;
        messages[messages.length - 1].content += contextPrompt;
      }
    } else if (progress && progress.questionsCompleted >= 6) {
      const contextPrompt = `\n\nCONTEXT: Discovery is complete (6/6 questions answered). Offer to schedule a consultation in a natural way.`;
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
      
      // Fallback to simple response if API fails
      const progress = globalDiscoveryManager.getProgress(this.callId);
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        return `Thank you for sharing that. ${nextQuestion.question}`;
      }
      return "Perfect! I have all the information I need. What day and time works best for you?";
    }
  }

  isSchedulingRequest(userMessage) {
    const schedulingKeywords = ['schedule', 'book', 'appointment', 'available', 'times', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const userLower = userMessage.toLowerCase();
    return schedulingKeywords.some(keyword => userLower.includes(keyword));
  }

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED');
    
    const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
    if (sessionInfo) {
      console.log(`💾 SESSION: ${sessionInfo.questionsCompleted}/6 questions completed`);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error);
  }
}

module.exports = WebSocketHandler;
