// src/handlers/WebSocketHandler.js - FINAL FIXED VERSION
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

CRITICAL RULES:
- Ask discovery questions in order, ONE AT A TIME
- Keep responses short and natural (1-2 sentences max)
- When user gives time preference like "Monday at 10 AM", confirm the booking immediately
- Don't skip questions - ask all 6 before scheduling

RESPONSE STYLE:
- Be concise and friendly
- Acknowledge their answer briefly, then ask next question
- For booking: "Perfect! I've booked your consultation for [day] at [time]. You'll receive a calendar invitation shortly!"`
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

    // FIXED: Check for specific time booking request - regardless of discovery progress
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    
    if (specificTimeMatch) {
      console.log('🕐 BOOKING TIME DETECTED:', specificTimeMatch.timeString);
      await this.handleSpecificTimeBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // Check for general availability request
    const isAvailabilityRequest = /what times|when are you|available|schedule|appointment|book|meet/i.test(userMessage) && 
                                 !/monday|tuesday|wednesday|thursday|friday/i.test(userMessage);
    
    if (isAvailabilityRequest) {
      console.log('🗓️ SHOWING AVAILABILITY');
      const quickResponse = "I have availability Monday through Friday from 9 AM to 5 PM Arizona time. What day and time works best for you?";
      
      this.conversationHistory.push({ role: 'assistant', content: quickResponse });
      this.sendResponse(quickResponse, parsed.response_id);
      return;
    }

    // Handle discovery process
    await this.handleDiscoveryProcess(userMessage, parsed.response_id);
  }

  detectSpecificTimeRequest(userMessage) {
    // FIXED: Better detection patterns for booking
    const patterns = [
      // "Monday at 10 AM", "tuesday 2pm", etc.
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "10 AM Monday", "2pm tuesday", etc.  
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
      // "Can do Monday at 10", "Monday 10am works"
      /(?:can do|works?|good|yes|ok|okay).*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "Monday at ten", "tuesday ten am"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)\s*(am|pm)/i
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
        } else if (i === 3) { // "Monday at ten"
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
      
      // FIXED: Always attempt booking, regardless of discovery progress
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
        response = `I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
        
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
    
    // FIXED: Better answer capture logic
    if (progress?.waitingForAnswer && !this.isSchedulingRequest(userMessage)) {
      const captured = globalDiscoveryManager.captureAnswer(
        this.callId, 
        progress.currentQuestionIndex, 
        userMessage.trim()
      );
      console.log(`📝 Answer captured: ${captured}`);
    }

    // FIXED: Use simple, direct responses based on discovery progress
    const botReply = this.getDirectDiscoveryResponse(progress);
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Check for question detection
    globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);

    this.sendResponse(botReply, responseId);
  }

  getDirectDiscoveryResponse(progress) {
    if (!progress || progress.questionsCompleted === 0) {
      return "How did you hear about us?";
    }
    
    const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
    if (nextQuestion) {
      // Simple acknowledgment + next question
      const acks = ["Great!", "Perfect!", "Got it!", "Thanks!"];
      const ack = acks[progress.questionsCompleted % acks.length];
      
      return `${ack} ${nextQuestion.question}`;
    }
    
    // All questions done
    return "Perfect! I have all the information I need. What day and time works best for you?";
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
