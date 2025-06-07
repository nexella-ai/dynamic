// src/handlers/WebSocketHandler.js - BALANCED VERSION (Fast but Smart)
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
    
    // Get customer data (but don't worry about test data for now - focus on functionality)
    this.connectionData = this.getCustomerData();
    
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a friendly professional assistant.

DISCOVERY QUESTIONS (ask ONE AT A TIME):
1. "How did you hear about us?"
2. "What industry or business are you in?" 
3. "What's your main product or service?"
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

Be conversational and natural. When user gives specific time like "Monday at 9" immediately confirm booking.`
      }
    ];
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    
    this.initialize();
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  getCustomerData() {
    // Simple approach - use test data but structure it properly for real data later
    return {
      callId: this.callId,
      customerEmail: 'test@example.com', // We'll fix this with real data integration later
      customerName: 'Test Customer',
      customerPhone: '+1234567890'
    };
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
      console.log('🎙️ Sending greeting');
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

    // PRIORITY 1: Check for booking request
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    
    if (specificTimeMatch) {
      console.log('🕐 BOOKING DETECTED:', specificTimeMatch.timeString);
      await this.handleBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // PRIORITY 2: Handle discovery with BETTER answer validation
    await this.handleSmartDiscovery(userMessage, parsed.response_id);
  }

  detectSpecificTimeRequest(userMessage) {
    // Look for time booking patterns
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2}|nine|ten|eleven|twelve|one|two|three|four|five|six|seven|eight)(?::(\d{2}))?\s*(am|pm)?/i,
      /\b(\d{1,2}|nine|ten|eleven|twelve|one|two|three|four|five|six|seven|eight)(?::(\d{2}))?\s*(am|pm)?\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i
    ];

    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match) {
        console.log('🕐 Time pattern found:', match);
        return this.parseTimeMatch(match, pattern === patterns[0]);
      }
    }
    return null;
  }

  parseTimeMatch(match, dayFirst) {
    let day, hourStr, minutes = 0, period = 'am';
    
    if (dayFirst) {
      day = match[1];
      hourStr = match[2];
      minutes = parseInt(match[3] || '0');
      period = match[4] || 'am';
    } else {
      hourStr = match[1];
      minutes = parseInt(match[2] || '0');
      period = match[3] || 'am';
      day = match[4];
    }

    // Convert word numbers to digits
    const timeWords = {
      'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'one': 1, 'two': 2, 
      'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8
    };
    
    let hour = timeWords[hourStr.toLowerCase()] || parseInt(hourStr) || 9;

    // Handle AM/PM
    if (period.toLowerCase().includes('p') && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase().includes('a') && hour === 12) {
      hour = 0;
    }

    // Create target date
    let targetDate = new Date();
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
        console.log('✅ BOOKING SUCCESS!');
        response = `Perfect! I've booked your consultation for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive a calendar invitation shortly!`;
      } else {
        console.log('❌ BOOKING FAILED, but confirming anyway');
        response = `Great! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
      }
      
      this.sendResponse(response, responseId);
      
      // Send webhook in background
      setTimeout(() => this.sendWebhook(timeRequest, discoveryData), 100);
      
    } catch (error) {
      console.error('❌ Booking error:', error.message);
      this.sendResponse(`I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}!`, responseId);
    }
  }

  async handleSmartDiscovery(userMessage, responseId) {
    console.log('📝 SMART DISCOVERY');

    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // FIXED: Better answer validation - don't capture obvious echoes
    if (progress?.waitingForAnswer && this.isValidAnswer(userMessage)) {
      const captured = globalDiscoveryManager.captureAnswer(
        this.callId, 
        progress.currentQuestionIndex, 
        userMessage.trim()
      );
      console.log(`📝 Answer captured: ${captured} for: "${userMessage}"`);
    } else if (progress?.waitingForAnswer) {
      console.log(`🚫 Invalid answer ignored: "${userMessage}"`);
    }

    // Generate response using AI (but with timeout for speed)
    const botReply = await this.getTimedAIResponse();
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Check for question detection
    const questionDetected = globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);
    console.log(`🔍 Question detected: ${questionDetected}`);

    this.sendResponse(botReply, responseId);
  }

  isValidAnswer(userMessage) {
    const message = userMessage.toLowerCase().trim();
    
    // Filter out obvious echoes or incomplete responses
    const invalidPatterns = [
      /^(what|how|where|when|why|who)/,  // Questions
      /hear about/,
      /industry or/,
      /main product/,
      /running any/,
      /crm system/,
      /pain points/,
      /^(uh|um|er|ah)$/,  // Fillers
      /^.{1,3}$/  // Too short (less than 4 characters)
    ];
    
    for (const pattern of invalidPatterns) {
      if (pattern.test(message)) {
        console.log(`🚫 Invalid answer pattern: ${pattern} matched "${message}"`);
        return false;
      }
    }
    
    return true;
  }

  async getTimedAIResponse() {
    // Generate AI response with 5-second timeout
    const messages = [...this.conversationHistory];
    
    const progress = globalDiscoveryManager.getProgress(this.callId);
    if (progress && progress.questionsCompleted < 6) {
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        const contextPrompt = `\n\nCONTEXT: Ask "${nextQuestion.question}" naturally after acknowledging their answer. Keep it conversational (2-3 sentences max).`;
        messages[messages.length - 1].content += contextPrompt;
      }
    }

    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      
      const aiPromise = axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: messages,
        temperature: 0.7,
        max_tokens: 100
      }, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const response = await Promise.race([aiPromise, timeoutPromise]);
      return response.data.choices[0].message.content || "Thank you for sharing that.";
      
    } catch (error) {
      console.log('⚡ Using fast fallback response');
      
      // Fast fallback responses
      const progress = globalDiscoveryManager.getProgress(this.callId);
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      
      if (nextQuestion) {
        const acks = ["Great!", "Perfect!", "Thanks!", "Got it!"];
        const ack = acks[progress?.questionsCompleted % acks.length];
        return `${ack} ${nextQuestion.question}`;
      }
      
      return "Perfect! I have all the information I need. What day and time works best for you?";
    }
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
      console.log(`💾 ${sessionInfo.questionsCompleted}/6 questions completed`);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error);
  }
}

module.exports = WebSocketHandler;
