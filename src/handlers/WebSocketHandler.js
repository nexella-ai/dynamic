// src/handlers/WebSocketHandler.js - FAST VERSION WITH NO DELAYS
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
- ALWAYS respond immediately, no delays
- Start with a friendly greeting if it's the first interaction
- Ask questions naturally and acknowledge previous answers
- Keep responses short and conversational
- When user gives specific time, confirm booking immediately

RESPONSE STYLE:
- Be concise and friendly
- Respond in 1-2 sentences maximum
- Ask one question at a time
- Acknowledge their answer briefly before next question`
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
    // FIXED: Send greeting immediately, no delay
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
    // FIXED: Send greeting IMMEDIATELY when connection opens
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
        // FIXED: Process immediately, no delays
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

    // Check for specific time booking request
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    
    if (specificTimeMatch && progress?.questionsCompleted >= 4) {
      console.log('🕐 BOOKING TIME:', specificTimeMatch.timeString);
      await this.handleSpecificTimeBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // Check for general availability request
    const isAvailabilityRequest = /what times|when are you|available|schedule|appointment|book|meet/i.test(userMessage);
    
    if (isAvailabilityRequest && progress?.questionsCompleted >= 4) {
      console.log('🗓️ SHOWING AVAILABILITY');
      globalDiscoveryManager.markSchedulingStarted(this.callId);
      
      // FIXED: Quick response without complex calendar lookup
      const quickResponse = "Perfect! I have availability Monday through Friday from 9 AM to 5 PM Arizona time. What day and time works best for you?";
      
      this.conversationHistory.push({ role: 'assistant', content: quickResponse });
      this.sendResponse(quickResponse, parsed.response_id);
      return;
    }

    // Handle discovery process
    await this.handleDiscoveryProcess(userMessage, parsed.response_id);
  }

  detectSpecificTimeRequest(userMessage) {
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
      /\b(\d{1,2})\s*(am|pm)\b/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = userMessage.match(patterns[i]);
      if (match) {
        let day, hour, minutes, period;
        
        if (i === 0) {
          day = match[1];
          hour = parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
        } else if (i === 1) {
          hour = parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = match[4];
        } else {
          hour = parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = 'monday'; // Default to next Monday
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
      console.log('🔄 BOOKING:', timeRequest.timeString);
      
      const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
      
      // FIXED: Quick booking without complex calendar checks
      const bookingResult = await autoBookAppointment(
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        timeRequest.dateTime,
        discoveryData
      );
      
      let response;
      
      if (bookingResult.success) {
        response = `Perfect! I've booked your consultation for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive a calendar invitation shortly!`;
        
        // Send webhook in background (don't wait)
        this.sendWebhookInBackground(timeRequest, discoveryData);
        
      } else {
        response = `That time isn't available. How about Monday at 2 PM or Tuesday at 10 AM instead?`;
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      this.sendResponse(response, responseId);
      
    } catch (error) {
      console.error('❌ Booking error:', error.message);
      const errorResponse = "I had trouble with that booking. How about Monday at 2 PM instead?";
      this.sendResponse(errorResponse, responseId);
    }
  }

  async sendWebhookInBackground(timeRequest, discoveryData) {
    // Don't wait for this - send in background
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

    // Generate quick AI response
    const botReply = await this.getQuickAIResponse();
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Check for question detection
    globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);

    const newProgress = globalDiscoveryManager.getProgress(this.callId);
    
    // Add scheduling hint if all questions done
    if (newProgress?.questionsCompleted === 6 && !newProgress?.schedulingStarted) {
      const finalResponse = botReply + " Perfect! I have all the information I need. Would you like to schedule a consultation?";
      this.sendResponse(finalResponse, responseId);
    } else {
      this.sendResponse(botReply, responseId);
    }
  }

  async getQuickAIResponse() {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // FIXED: Use predetermined responses for speed
    if (!progress || progress.questionsCompleted === 0) {
      return "How did you hear about us?";
    }
    
    const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
    if (nextQuestion) {
      const questionNumber = progress.questionsCompleted + 1;
      
      // Quick acknowledgments + next question
      const acknowledgments = ["Great!", "Perfect!", "Awesome!", "Got it!", "Excellent!"];
      const ack = acknowledgments[Math.floor(Math.random() * acknowledgments.length)];
      
      return `${ack} ${nextQuestion.question}`;
    }
    
    return "Perfect! I have all the information I need.";
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
