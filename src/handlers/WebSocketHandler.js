// src/handlers/WebSocketHandler.js - COMPLETE FIXED VERSION
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
  removeCallMetadata,
  getActiveCallsMetadata
} = require('../services/webhooks/WebhookService');

class WebSocketHandler {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    console.log('🔗 NEW CONNECTION - Call ID:', this.callId);
    
    // FIXED: Get real customer data from call metadata or Typeform
    this.connectionData = this.getCustomerData();
    
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
- Keep responses warm but concise (2-3 sentences max)
- Always acknowledge their answer, then ask the next question naturally

BOOKING BEHAVIOR:
- When user gives specific time like "Monday at 9" or "Monday at nine", immediately confirm booking
- Say: "Perfect! I've booked your consultation for [day] at [time]. You'll receive a calendar invitation shortly!"

CRITICAL: Ask ALL 6 questions before offering scheduling, unless user specifically requests a time.`
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

  // FIXED: Get real customer data from multiple sources
  getCustomerData() {
    console.log('🔍 Getting customer data...');
    
    // Method 1: Check active calls metadata (from Retell webhook)
    const activeCallsMetadata = getActiveCallsMetadata();
    if (this.callId && activeCallsMetadata.has(this.callId)) {
      const callMetadata = activeCallsMetadata.get(this.callId);
      console.log('📞 Found call metadata:', callMetadata);
      
      return {
        callId: this.callId,
        customerEmail: callMetadata.customer_email || callMetadata.email || 'unknown@example.com',
        customerName: callMetadata.customer_name || callMetadata.name || 'Customer',
        customerPhone: callMetadata.customer_phone || callMetadata.phone || callMetadata.to_number || '+1234567890'
      };
    }
    
    // Method 2: Check global Typeform submission
    if (global.lastTypeformSubmission) {
      console.log('📝 Found Typeform submission:', global.lastTypeformSubmission);
      
      return {
        callId: this.callId,
        customerEmail: global.lastTypeformSubmission.email || 'unknown@example.com',
        customerName: global.lastTypeformSubmission.name || 'Customer',
        customerPhone: global.lastTypeformSubmission.phone || '+1234567890'
      };
    }
    
    // Method 3: Fallback to test data with warning
    console.warn('⚠️ No real customer data found - using fallback test data');
    console.warn('💡 Make sure Typeform webhook or Retell metadata is properly configured');
    
    return {
      callId: this.callId,
      customerEmail: 'customer@example.com',
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
    console.log(`👤 CUSTOMER: ${this.connectionData.customerName} (${this.connectionData.customerEmail})`);
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
      
      // Personalized greeting if we have a name
      let greeting = "Hi there! This is Sarah from Nexella AI. How are you doing today?";
      if (this.connectionData.customerName && this.connectionData.customerName !== 'Test Customer') {
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

    this.conversationHistory.push({ role: 'user', content: userMessage });

    // PRIORITY 1: Check for specific time booking request FIRST
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    
    if (specificTimeMatch) {
      console.log('🕐 BOOKING TIME DETECTED:', specificTimeMatch.timeString);
      await this.handleSpecificTimeBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // PRIORITY 2: Check for general availability request (only if 4+ questions done)
    const isAvailabilityRequest = /what times|when are you|available|schedule|appointment|book|meet/i.test(userMessage) && 
                                 !/monday|tuesday|wednesday|thursday|friday/i.test(userMessage);
    
    if (isAvailabilityRequest && progress?.questionsCompleted >= 4) {
      console.log('🗓️ SHOWING AVAILABILITY (4+ questions done)');
      const quickResponse = "I have availability Monday through Friday from 9 AM to 5 PM Arizona time. What day and time works best for you?";
      
      this.conversationHistory.push({ role: 'assistant', content: quickResponse });
      this.sendResponse(quickResponse, parsed.response_id);
      return;
    } else if (isAvailabilityRequest && progress?.questionsCompleted < 4) {
      console.log('🗓️ AVAILABILITY REQUEST TOO EARLY - Continue discovery');
      const earlyResponse = "I'd love to schedule a time with you! Let me just get a bit more information first. ";
      
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        const response = earlyResponse + nextQuestion.question;
        this.conversationHistory.push({ role: 'assistant', content: response });
        this.sendResponse(response, parsed.response_id);
        
        // Mark the question as asked
        const questionIndex = globalDiscoveryManager.getSession(this.callId).questions.findIndex(q => q.question === nextQuestion.question);
        if (questionIndex >= 0) {
          globalDiscoveryManager.markQuestionAsked(this.callId, questionIndex, response);
        }
      }
      return;
    }

    // PRIORITY 3: Handle discovery process with contextual responses
    await this.handleDiscoveryProcess(userMessage, parsed.response_id);
  }

  detectSpecificTimeRequest(userMessage) {
    // ENHANCED: More comprehensive booking detection including word numbers
    const patterns = [
      // "Monday at 9", "tuesday 2pm", etc.
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
      // "9 AM Monday", "2pm tuesday", etc.  
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
      // "Monday at nine", "tuesday ten am" (word numbers)
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(nine|ten|eleven|twelve|one|two|three|four|five|six|seven|eight)\s*(am|pm)?/i,
      // Just word numbers if in context: "nine", "ten am"
      /\b(nine|ten|eleven|twelve|one|two|three|four|five|six|seven|eight)\s*(am|pm)/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = userMessage.match(patterns[i]);
      if (match) {
        console.log('🕐 Time pattern matched:', match);
        
        let day, hour, minutes, period;
        
        if (i === 0) { // Day with number
          day = match[1];
          hour = parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4] || 'am'; // Default to AM if not specified
        } else if (i === 1) { // Number with day
          hour = parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = match[4];
        } else if (i === 2) { // Day with word number
          day = match[1];
          const timeWords = {
            'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'one': 1, 'two': 2, 
            'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8
          };
          hour = timeWords[match[2]] || 9;
          minutes = 0;
          period = match[3] || 'am';
        } else if (i === 3) { // Just word number
          const timeWords = {
            'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'one': 1, 'two': 2, 
            'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8
          };
          hour = timeWords[match[1]] || 9;
          minutes = 0;
          period = match[2] || 'am';
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
    
    // Handle AM/PM conversion
    if (period && period.toLowerCase().includes('p') && hour !== 12) {
      hour += 12;
    } else if (period && period.toLowerCase().includes('a') && hour === 12) {
      hour = 0;
    } else if (!period && hour <= 8) {
      // If no AM/PM specified and hour is 1-8, assume PM for business hours
      hour += 12;
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

  async handleSpecificTimeBooking(timeRequest, responseId) {
    try {
      console.log('🔄 ATTEMPTING REAL BOOKING:', timeRequest.timeString);
      console.log('👤 Customer info:', this.connectionData);
      
      const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
      console.log('📝 Discovery data:', discoveryData);
      
      // FIXED: Actually attempt real booking
      const bookingResult = await autoBookAppointment(
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        timeRequest.dateTime,
        discoveryData
      );
      
      console.log('📅 Booking result:', bookingResult);
      
      let response;
      
      if (bookingResult.success) {
        console.log('✅ REAL BOOKING SUCCESS!');
        response = `Perfect! I've booked your consultation for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive a calendar invitation at ${this.connectionData.customerEmail} shortly!`;
        
        // Send webhook with booking confirmation
        this.sendWebhookInBackground(timeRequest, discoveryData, true);
        
      } else {
        console.log('❌ BOOKING FAILED:', bookingResult.error);
        response = `I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details at ${this.connectionData.customerEmail} shortly!`;
        
        // Send webhook for manual follow-up
        this.sendWebhookInBackground(timeRequest, discoveryData, false);
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      this.sendResponse(response, responseId);
      
    } catch (error) {
      console.error('❌ Booking error:', error.message);
      const errorResponse = `Great! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
      this.sendResponse(errorResponse, responseId);
      
      // Send webhook for manual follow-up
      this.sendWebhookInBackground(timeRequest, globalDiscoveryManager.getFinalDiscoveryData(this.callId), false);
    }
  }

  async sendWebhookInBackground(timeRequest, discoveryData, bookingSuccess) {
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
        console.log(`✅ Background webhook sent (booking: ${bookingSuccess ? 'success' : 'manual needed'})`);
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

    // Generate contextual AI response
    const botReply = await this.getContextualAIResponse();
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // FIXED: Always check for question detection
    const questionDetected = globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);
    console.log(`🔍 Question detected: ${questionDetected}`);

    // FIXED: If no question detected and we should ask one, ask it directly
    const newProgress = globalDiscoveryManager.getProgress(this.callId);
    if (!questionDetected && newProgress?.questionsCompleted < 6) {
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        console.log('🔧 MANUALLY ASKING NEXT QUESTION:', nextQuestion.question);
        const enhancedReply = botReply + " " + nextQuestion.question;
        
        // Mark question as asked
        const questionIndex = globalDiscoveryManager.getSession(this.callId).questions.findIndex(q => q.question === nextQuestion.question);
        if (questionIndex >= 0) {
          globalDiscoveryManager.markQuestionAsked(this.callId, questionIndex, enhancedReply);
        }
        
        this.sendResponse(enhancedReply, responseId);
        return;
      }
    }

    this.sendResponse(botReply, responseId);
  }

  async getContextualAIResponse() {
    const messages = [...this.conversationHistory];
    
    // Add discovery context
    const progress = globalDiscoveryManager.getProgress(this.callId);
    if (progress && progress.questionsCompleted < 6) {
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        const contextPrompt = `\n\nCONTEXT: You are in discovery mode (${progress.questionsCompleted}/6 questions completed). Give a natural, contextual response that acknowledges their previous answer. Keep it conversational and engaging (2-3 sentences max). The next question you should ask is: "${nextQuestion.question}"`;
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

      return openaiResponse.data.choices[0].message.content || "Thank you for sharing that.";
    } catch (error) {
      console.error('❌ OpenAI error:', error.message);
      
      // Fallback to simple contextual response
      const progress = globalDiscoveryManager.getProgress(this.callId);
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      
      if (nextQuestion) {
        const acks = ["Thank you for sharing that.", "That's great!", "Perfect!", "Got it!"];
        const ack = acks[progress?.questionsCompleted % acks.length];
        return `${ack} ${nextQuestion.question}`;
      }
      return "Perfect! I have all the information I need. What day and time works best for you?";
    }
  }

  isSchedulingRequest(userMessage) {
    const schedulingKeywords = ['schedule', 'book', 'appointment', 'available', 'times'];
    const userLower = userMessage.toLowerCase();
    return schedulingKeywords.some(keyword => userLower.includes(keyword));
  }

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED');
    
    const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
    if (sessionInfo) {
      console.log(`💾 SESSION: ${sessionInfo.questionsCompleted}/6 questions completed`);
      console.log(`👤 CUSTOMER: ${this.connectionData.customerName} (${this.connectionData.customerEmail})`);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error);
  }
}

module.exports = WebSocketHandler;
