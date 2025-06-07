// src/handlers/WebSocketHandler.js - FAST VERSION WITH REAL DATA
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment
} = require('../services/calendar/CalendarHelpers');
const { 
  sendSchedulingPreference, 
  getActiveCallsMetadata
} = require('../services/webhooks/WebhookService');

class WebSocketHandler {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    console.log('🔗 NEW CONNECTION - Call ID:', this.callId);
    
    // FIXED: Get real customer data immediately
    this.connectionData = this.getRealCustomerData();
    console.log('👤 REAL CUSTOMER DATA:', this.connectionData);
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    
    this.initialize();
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  // FIXED: Get real customer data from actual sources
  getRealCustomerData() {
    console.log('🔍 Looking for REAL customer data...');
    
    // Source 1: Active calls metadata (from Retell)
    const activeCallsMetadata = getActiveCallsMetadata();
    console.log('📞 Active calls metadata count:', activeCallsMetadata.size);
    console.log('📞 Call IDs in metadata:', Array.from(activeCallsMetadata.keys()));
    
    if (this.callId && activeCallsMetadata.has(this.callId)) {
      const callMetadata = activeCallsMetadata.get(this.callId);
      console.log('✅ FOUND RETELL METADATA:', callMetadata);
      
      return {
        callId: this.callId,
        customerEmail: callMetadata.customer_email || callMetadata.email || 'unknown@example.com',
        customerName: callMetadata.customer_name || callMetadata.name || 'Customer',
        customerPhone: callMetadata.customer_phone || callMetadata.phone || callMetadata.to_number || '+1234567890'
      };
    }
    
    // Source 2: Global Typeform submission
    console.log('📝 Checking global Typeform submission...');
    if (global.lastTypeformSubmission) {
      console.log('✅ FOUND TYPEFORM DATA:', global.lastTypeformSubmission);
      
      return {
        callId: this.callId,
        customerEmail: global.lastTypeformSubmission.email,
        customerName: global.lastTypeformSubmission.name || 'Customer',
        customerPhone: global.lastTypeformSubmission.phone || '+1234567890'
      };
    }
    
    // Source 3: Extract from URL parameters (if any)
    try {
      const url = new URL(this.req.url, 'http://localhost');
      const email = url.searchParams.get('email');
      const name = url.searchParams.get('name');
      const phone = url.searchParams.get('phone');
      
      if (email) {
        console.log('✅ FOUND URL PARAMS:', { email, name, phone });
        return {
          callId: this.callId,
          customerEmail: email,
          customerName: name || 'Customer',
          customerPhone: phone || '+1234567890'
        };
      }
    } catch (error) {
      console.log('📝 No URL params found');
    }
    
    // LAST RESORT: Test data with clear warning
    console.warn('⚠️ NO REAL CUSTOMER DATA FOUND!');
    console.warn('💡 Check these integrations:');
    console.warn('   1. Typeform webhook storing to global.lastTypeformSubmission');
    console.warn('   2. Retell webhook storing call metadata');
    console.warn('   3. URL parameters: ?email=x&name=y&phone=z');
    
    return {
      callId: this.callId,
      customerEmail: 'test@example.com',
      customerName: 'Test Customer',
      customerPhone: '+1234567890'
    };
  }

  async initialize() {
    this.initializeDiscoverySession();
    this.setupEventHandlers();
    // FIXED: Immediate greeting
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
      console.log('🎙️ IMMEDIATE GREETING');
      
      // Use real name if available
      let greeting = "Hi there! This is Sarah from Nexella AI. How are you doing today?";
      if (this.connectionData.customerName && 
          this.connectionData.customerName !== 'Test Customer' && 
          this.connectionData.customerName !== 'Customer') {
        greeting = `Hi ${this.connectionData.customerName}! This is Sarah from Nexella AI. How are you doing today?`;
      }
      
      this.sendResponse(greeting, 1);
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

    // PRIORITY 1: Booking detection FIRST
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    
    if (specificTimeMatch) {
      console.log('🕐 BOOKING:', specificTimeMatch.timeString);
      await this.handleBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // PRIORITY 2: Discovery questions (FAST responses)
    await this.handleFastDiscovery(userMessage, parsed.response_id);
  }

  detectSpecificTimeRequest(userMessage) {
    const patterns = [
      // "Monday at 9", "Monday 9", "Monday at nine"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2}|nine|ten|eleven|twelve|one|two|three|four|five|six|seven|eight)(?::(\d{2}))?\s*(am|pm)?/i,
      // "9 Monday", "nine AM Monday"
      /\b(\d{1,2}|nine|ten|eleven|twelve|one|two|three|four|five|six|seven|eight)(?::(\d{2}))?\s*(am|pm)?\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i
    ];

    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match) {
        console.log('🕐 MATCH:', match);
        
        let day, hour, minutes = 0, period = 'am';
        
        if (pattern === patterns[0]) { // Day first
          day = match[1];
          hour = this.parseHour(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4] || 'am';
        } else { // Time first
          hour = this.parseHour(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3] || 'am';
          day = match[4];
        }

        return this.parseDateTime(day, hour, minutes, period);
      }
    }
    return null;
  }

  parseHour(hourStr) {
    const timeWords = {
      'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'one': 1, 'two': 2, 
      'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8
    };
    return timeWords[hourStr.toLowerCase()] || parseInt(hourStr) || 9;
  }

  parseDateTime(day, hour, minutes, period) {
    let targetDate = new Date();
    
    // Parse day
    if (day === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (day !== 'today') {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = daysOfWeek.indexOf(day.toLowerCase());
      if (dayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = dayIndex - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    // Handle AM/PM
    if (period.toLowerCase().includes('p') && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase().includes('a') && hour === 12) {
      hour = 0;
    }
    
    targetDate.setHours(hour, minutes, 0, 0);
    
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const displayPeriod = hour >= 12 ? 'PM' : 'AM';
    
    return {
      dateTime: targetDate,
      dayName: day,
      timeString: `${displayHour}:${minutes.toString().padStart(2, '0')} ${displayPeriod}`
    };
  }

  async handleBooking(timeRequest, responseId) {
    try {
      console.log('🔄 BOOKING:', timeRequest.timeString);
      console.log('👤 WITH:', this.connectionData.customerEmail);
      
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
        response = `Perfect! I've booked your consultation for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive a calendar invitation at ${this.connectionData.customerEmail} shortly!`;
      } else {
        response = `Great! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
      }
      
      this.sendResponse(response, responseId);
      
      // Background webhook
      setTimeout(() => this.sendWebhook(timeRequest, discoveryData), 100);
      
    } catch (error) {
      console.error('❌ Booking error:', error.message);
      this.sendResponse(`I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}!`, responseId);
    }
  }

  async handleFastDiscovery(userMessage, responseId) {
    console.log('📝 FAST DISCOVERY');

    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // Capture answer
    if (progress?.waitingForAnswer) {
      globalDiscoveryManager.captureAnswer(this.callId, progress.currentQuestionIndex, userMessage.trim());
    }

    // FIXED: Fast predetermined responses (no AI delays)
    const response = this.getFastResponse(progress);
    
    // Mark question as asked if it contains a question
    globalDiscoveryManager.detectQuestionInBotMessage(this.callId, response);
    
    this.sendResponse(response, responseId);
  }

  getFastResponse(progress) {
    const questions = [
      "How did you hear about us?",
      "What industry or business are you in?", 
      "What's your main product or service?",
      "Are you currently running any ads?",
      "Are you using any CRM system?",
      "What are your biggest pain points or challenges?"
    ];

    const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
    
    if (nextQuestion) {
      const questionIndex = questions.indexOf(nextQuestion.question);
      const acks = ["Great!", "Perfect!", "Awesome!", "Got it!", "Excellent!", "Thanks!"];
      
      if (progress?.questionsCompleted > 0) {
        return `${acks[questionIndex % acks.length]} ${nextQuestion.question}`;
      } else {
        return nextQuestion.question;
      }
    }
    
    return "Perfect! I have all the information I need. What day and time works best for you?";
  }

  async sendWebhook(timeRequest, discoveryData) {
    try {
      await sendSchedulingPreference(
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        `${timeRequest.dayName} at ${timeRequest.timeString}`,
        this.callId,
        discoveryData
      );
      console.log('✅ Webhook sent');
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  }

  async handleClose() {
    console.log('🔌 CLOSED');
    const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
    if (sessionInfo) {
      console.log(`💾 ${sessionInfo.questionsCompleted}/6 questions`);
    }
  }

  handleError(error) {
    console.error('❌ Error:', error);
  }
}

module.exports = WebSocketHandler;
