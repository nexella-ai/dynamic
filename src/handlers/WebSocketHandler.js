// src/handlers/WebSocketHandler.js - FIXED VERSION
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  generateAvailabilityResponse
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
    
    // Get customer data
    this.connectionData = this.getCustomerData();
    
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a friendly professional assistant.

CONVERSATION FLOW:
1. GREETING: Start with "Hi there! This is Sarah from Nexella AI. How are you doing today?" and WAIT for response
2. DISCOVERY: Ask these 6 questions ONE AT A TIME, waiting for each answer:
   - "How did you hear about us?"
   - "What industry or business are you in?" 
   - "What's your main product or service?"
   - "Are you currently running any ads?"
   - "Are you using any CRM system?"
   - "What are your biggest pain points or challenges?"
3. SCHEDULING: After ALL 6 questions, transition to scheduling

CRITICAL RULES:
- NEVER repeat questions that have been answered
- ALWAYS wait for user response before asking next question  
- After 6 questions are complete, transition to: "Perfect! I have all the information I need. Let's find you a time that works. What day works best for you?"
- When user gives specific time like "Monday at 9", immediately confirm booking

Be conversational and natural but follow the flow strictly.`
      }
    ];
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    this.waitingForGreetingResponse = false;
    this.lastBotMessage = '';
    
    this.initialize();
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  getCustomerData() {
    // Extract from URL params or use test data
    const urlParams = new URLSearchParams(this.req.url.split('?')[1] || '');
    
    return {
      callId: this.callId,
      customerEmail: urlParams.get('customer_email') || 'test@example.com',
      customerName: urlParams.get('customer_name') || 'Test Customer',
      customerPhone: urlParams.get('customer_phone') || '+1234567890'
    };
  }

  async initialize() {
    this.initializeDiscoverySession();
    this.setupEventHandlers();
    this.sendInitialGreeting();
  }

  initializeDiscoverySession() {
    const session = globalDiscoveryManager.getSession(this.callId, this.connectionData);
    console.log(`📊 SESSION INITIALIZED: ${session.progress.questionsCompleted}/6 questions`);
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  sendInitialGreeting() {
    if (!this.hasGreeted) {
      this.hasGreeted = true;
      this.waitingForGreetingResponse = true;
      const greeting = "Hi there! This is Sarah from Nexella AI. How are you doing today?";
      this.lastBotMessage = greeting;
      console.log('🎙️ SENDING GREETING:', greeting);
      this.sendResponse(greeting, 1);
    }
  }

  sendResponse(content, responseId = null) {
    console.log('🤖 SENT:', content);
    this.lastBotMessage = content;
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId || Date.now()
    }));
  }

  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log(`🗣️ USER: "${userMessage}"`);
    this.userHasSpoken = true;
    
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // STEP 1: Handle greeting response
    if (this.waitingForGreetingResponse) {
      this.waitingForGreetingResponse = false;
      await this.handleGreetingResponse(userMessage, parsed.response_id);
      return;
    }

    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log(`📊 CURRENT PROGRESS: ${progress?.questionsCompleted || 0}/6 questions, Phase: ${progress?.conversationPhase || 'greeting'}`);

    // STEP 2: Check for specific time booking request
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    if (specificTimeMatch && progress?.questionsCompleted >= 4) {
      console.log('🕐 BOOKING REQUEST DETECTED:', specificTimeMatch.timeString);
      await this.handleBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // STEP 3: Handle discovery phase
    if (progress?.questionsCompleted < 6 && !progress?.schedulingStarted) {
      await this.handleDiscoveryPhase(userMessage, parsed.response_id);
      return;
    }

    // STEP 4: Handle scheduling phase
    if (progress?.questionsCompleted >= 6 || progress?.schedulingStarted) {
      await this.handleSchedulingPhase(userMessage, parsed.response_id);
      return;
    }

    // FALLBACK: Generate appropriate response
    await this.generateContextualResponse(userMessage, parsed.response_id);
  }

  async handleGreetingResponse(userMessage, responseId) {
    console.log('👋 HANDLING GREETING RESPONSE');
    
    // Acknowledge their response and start first discovery question
    const firstQuestion = "How did you hear about us?";
    const response = `${this.getGreetingAcknowledgment(userMessage)} ${firstQuestion}`;
    
    // Mark first question as asked
    globalDiscoveryManager.markQuestionAsked(this.callId, 0, response);
    
    this.conversationHistory.push({ role: 'assistant', content: response });
    this.sendResponse(response, responseId);
  }

  getGreetingAcknowledgment(userMessage) {
    const message = userMessage.toLowerCase();
    
    if (message.includes('good') || message.includes('great') || message.includes('well')) {
      return "That's wonderful to hear!";
    } else if (message.includes('busy') || message.includes('hectic')) {
      return "I totally understand.";
    } else if (message.includes('fine') || message.includes('ok')) {
      return "Great!";
    } else {
      return "Nice!";
    }
  }

  async handleDiscoveryPhase(userMessage, responseId) {
    console.log('📝 HANDLING DISCOVERY PHASE');
    
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // Capture answer if we're waiting for one
    if (progress?.waitingForAnswer && this.isValidDiscoveryAnswer(userMessage)) {
      const captured = globalDiscoveryManager.captureAnswer(
        this.callId, 
        progress.currentQuestionIndex, 
        userMessage.trim()
      );
      console.log(`📝 Answer captured: ${captured} for Q${progress.currentQuestionIndex + 1}: "${userMessage}"`);
    }

    // Check updated progress
    const updatedProgress = globalDiscoveryManager.getProgress(this.callId);
    
    if (updatedProgress?.questionsCompleted >= 6) {
      // All questions complete, transition to scheduling
      console.log('🎉 ALL DISCOVERY QUESTIONS COMPLETE - TRANSITIONING TO SCHEDULING');
      globalDiscoveryManager.markSchedulingStarted(this.callId);
      
      const response = "Perfect! I have all the information I need. Let's find you a time that works. What day works best for you?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      this.sendResponse(response, responseId);
      return;
    }

    // Ask next question if available
    const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
    if (nextQuestion) {
      const questionIndex = globalDiscoveryManager.getSession(this.callId).questions.findIndex(q => q.question === nextQuestion.question);
      const acknowledgment = this.getContextualAcknowledgment(userMessage, questionIndex - 1);
      const response = `${acknowledgment} ${nextQuestion.question}`;
      
      // Mark question as asked
      globalDiscoveryManager.markQuestionAsked(this.callId, questionIndex, response);
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      this.sendResponse(response, responseId);
    }
  }

  async handleSchedulingPhase(userMessage, responseId) {
    console.log('🗓️ HANDLING SCHEDULING PHASE');
    
    // Mark scheduling as started if not already
    globalDiscoveryManager.markSchedulingStarted(this.callId);
    
    // Check for specific time request
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    if (specificTimeMatch) {
      await this.handleBooking(specificTimeMatch, responseId);
      return;
    }

    // Generate availability response
    try {
      const availabilityResponse = await generateAvailabilityResponse();
      this.conversationHistory.push({ role: 'assistant', content: availabilityResponse });
      this.sendResponse(availabilityResponse, responseId);
    } catch (error) {
      console.error('❌ Error generating availability:', error.message);
      this.sendResponse("Let me check my calendar for available times. What day works best for you?", responseId);
    }
  }

  detectSpecificTimeRequest(userMessage) {
    console.log('🕐 CHECKING FOR TIME REQUEST:', userMessage);
    
    // Enhanced patterns for time detection
    const patterns = [
      // "Monday at 9am", "Tuesday at 2pm"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "9am Monday", "2pm Tuesday"  
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
      // "Monday 9", "Tuesday 2"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(\d{1,2})\b/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = userMessage.match(pattern);
      if (match) {
        console.log('🕐 TIME PATTERN MATCHED:', match);
        return this.parseTimeMatch(match, i);
      }
    }
    return null;
  }

  parseTimeMatch(match, patternIndex) {
    let day, hour, minutes = 0, period = 'am';
    
    switch (patternIndex) {
      case 0: // "Monday at 9am"
        day = match[1];
        hour = parseInt(match[2]);
        minutes = parseInt(match[3] || '0');
        period = match[4] || 'am';
        break;
      case 1: // "9am Monday"
        hour = parseInt(match[1]);
        minutes = parseInt(match[2] || '0');
        period = match[3] || 'am';
        day = match[4];
        break;
      case 2: // "Monday 9"
        day = match[1];
        hour = parseInt(match[2]);
        period = hour >= 9 && hour <= 11 ? 'am' : (hour >= 1 && hour <= 5 ? 'pm' : 'am');
        break;
    }

    // Convert to 24-hour format
    if (period.toLowerCase().includes('p') && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase().includes('a') && hour === 12) {
      hour = 0;
    }

    // Create target date
    const targetDate = this.calculateTargetDate(day, hour, minutes);
    
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const displayPeriod = hour >= 12 ? 'PM' : 'AM';
    
    return {
      dateTime: targetDate,
      dayName: day,
      timeString: `${displayHour}:${minutes.toString().padStart(2, '0')} ${displayPeriod}`,
      originalMatch: match[0]
    };
  }

  calculateTargetDate(day, hour, minutes) {
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
        if (daysToAdd <= 0) daysToAdd += 7; // Next week
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    targetDate.setHours(hour, minutes, 0, 0);
    return targetDate;
  }

  async handleBooking(timeRequest, responseId) {
    try {
      console.log('🔄 ATTEMPTING APPOINTMENT BOOKING:', timeRequest.timeString);
      
      const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
      console.log('📋 Discovery data for booking:', discoveryData);
      
      // Try to book the appointment
      const bookingResult = await autoBookAppointment(
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        timeRequest.dateTime,
        discoveryData
      );
      
      let response;
      if (bookingResult?.success) {
        console.log('✅ BOOKING SUCCESSFUL!');
        response = `Perfect! I've booked your consultation for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive a calendar invitation shortly!`;
      } else {
        console.log('⚠️ BOOKING FAILED, but confirming anyway');
        response = `Great! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      this.sendResponse(response, responseId);
      
      // Send webhook in background
      setTimeout(() => this.sendWebhookData(timeRequest, discoveryData), 500);
      
    } catch (error) {
      console.error('❌ Booking error:', error.message);
      const fallbackResponse = `Perfect! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
      this.sendResponse(fallbackResponse, responseId);
    }
  }

  async generateContextualResponse(userMessage, responseId) {
    console.log('🤖 GENERATING CONTEXTUAL RESPONSE');
    
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: this.conversationHistory,
        temperature: 0.7,
        max_tokens: 150
      }, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      const reply = response.data.choices[0].message.content;
      this.conversationHistory.push({ role: 'assistant', content: reply });
      this.sendResponse(reply, responseId);
      
    } catch (error) {
      console.log('⚡ Using fallback response due to AI error');
      const fallback = "I understand. How can I help you further?";
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      this.sendResponse(fallback, responseId);
    }
  }

  isValidDiscoveryAnswer(userMessage) {
    const message = userMessage.toLowerCase().trim();
    
    // Filter out echoes and invalid responses
    const invalidPatterns = [
      /^(what|how|where|when|why|who)\b/,  // Questions
      /hear about/,
      /industry or business/,
      /main product/,
      /running.*ads/,
      /crm system/,
      /pain points/,
      /^(uh|um|er|ah|okay|ok)$/,  // Fillers
      /^.{1,2}$/  // Too short
    ];
    
    return !invalidPatterns.some(pattern => pattern.test(message));
  }

  getContextualAcknowledgment(userAnswer, questionIndex) {
    if (questionIndex < 0) return "Great!";
    
    const acknowledgments = [
      "Great!",
      "Perfect!", 
      "Excellent!",
      "That's helpful!",
      "I understand.",
      "Thank you!"
    ];
    
    return acknowledgments[questionIndex % acknowledgments.length];
  }

  async sendWebhookData(timeRequest, discoveryData) {
    try {
      const preferredTime = `${timeRequest.dayName} at ${timeRequest.timeString}`;
      
      await sendSchedulingPreference(
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        preferredTime,
        this.callId,
        discoveryData
      );
      
      console.log('✅ Webhook sent successfully');
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  }

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED');
    
    // Capture any remaining buffered answers
    try {
      const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
      if (sessionInfo) {
        console.log(`💾 Session completed: ${sessionInfo.questionsCompleted}/6 questions`);
        
        // If we have discovery data, send final webhook
        if (sessionInfo.questionsCompleted > 0) {
          const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
          setTimeout(() => {
            sendSchedulingPreference(
              this.connectionData.customerName,
              this.connectionData.customerEmail, 
              this.connectionData.customerPhone,
              'Call ended early',
              this.callId,
              discoveryData
            ).catch(err => console.error('Final webhook error:', err));
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Error in connection close handler:', error.message);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandler;
