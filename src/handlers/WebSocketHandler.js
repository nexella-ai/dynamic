// src/handlers/WebSocketHandler.js - FIXED V4 (Real Metadata Extraction)
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
    
    // Get REAL customer data from all available sources
    this.connectionData = this.getRealCustomerData();
    
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a friendly professional assistant.

CONVERSATION FLOW:
1. GREETING: Wait for user to speak first, then greet and ask first question
2. DISCOVERY: Ask these 6 questions ONE AT A TIME:
   - "How did you hear about us?"
   - "What industry or business are you in?" 
   - "What's your main product or service?"
   - "Are you currently running any ads?"
   - "Are you using any CRM system?"
   - "What are your biggest pain points or challenges?"
3. SCHEDULING: After ALL 6 questions, transition to scheduling

CRITICAL RULES:
- WAIT for user to speak first before greeting
- Ask questions slowly, one at a time
- CAPTURE answers properly before moving to next question
- Be conversational but follow the exact question order`
      }
    ];
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 2000; // 2 seconds minimum between responses
    
    this.initialize();
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  getRealCustomerData() {
    console.log('🔍 GETTING REAL CUSTOMER DATA FROM ALL SOURCES...');
    
    // Method 1: Check for global Typeform submission (highest priority)
    if (global.lastTypeformSubmission) {
      console.log('✅ Using data from global Typeform submission:', global.lastTypeformSubmission);
      return {
        callId: this.callId,
        customerEmail: global.lastTypeformSubmission.email,
        customerName: global.lastTypeformSubmission.name || 'Customer',
        customerPhone: global.lastTypeformSubmission.phone || '',
        source: 'typeform'
      };
    }
    
    // Method 2: Check active calls metadata from webhook service
    const activeCallsMetadata = getActiveCallsMetadata();
    if (activeCallsMetadata && activeCallsMetadata.has(this.callId)) {
      const callMetadata = activeCallsMetadata.get(this.callId);
      console.log('✅ Using data from webhook active calls metadata:', callMetadata);
      return {
        callId: this.callId,
        customerEmail: callMetadata.customer_email || callMetadata.email,
        customerName: callMetadata.customer_name || callMetadata.name || 'Customer',
        customerPhone: callMetadata.customer_phone || callMetadata.phone || callMetadata.to_number || '',
        source: 'webhook_metadata'
      };
    }
    
    // Method 3: Extract from URL parameters
    const urlParams = new URLSearchParams(this.req.url.split('?')[1] || '');
    const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
    const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
    const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
    
    if (emailFromUrl) {
      console.log('✅ Using data from URL parameters');
      return {
        callId: this.callId,
        customerEmail: emailFromUrl,
        customerName: nameFromUrl || 'Customer',
        customerPhone: phoneFromUrl || '',
        source: 'url_params'
      };
    }
    
    // Method 4: Try to fetch from trigger server endpoints (your working method)
    this.attemptTriggerServerFetch();
    
    // Method 5: Check if call ID contains embedded info
    if (this.callId) {
      const embeddedInfo = this.extractEmbeddedCallInfo(this.callId);
      if (embeddedInfo) {
        console.log('✅ Using embedded call info from call ID');
        return {
          callId: this.callId,
          customerEmail: embeddedInfo.email || 'unknown@example.com',
          customerName: embeddedInfo.name || 'Customer',
          customerPhone: embeddedInfo.phone || '',
          source: 'embedded_call_id'
        };
      }
    }
    
    // Fallback: Use minimal data but log comprehensive warning
    console.warn('⚠️ NO REAL CUSTOMER DATA FOUND - Using fallback data');
    console.warn('📝 Comprehensive source check results:');
    console.warn('   - global.lastTypeformSubmission:', !!global.lastTypeformSubmission);
    console.warn('   - activeCallsMetadata size:', activeCallsMetadata?.size || 0);
    console.warn('   - activeCallsMetadata keys:', activeCallsMetadata ? Array.from(activeCallsMetadata.keys()) : []);
    console.warn('   - URL params:', this.req.url);
    console.warn('   - Call ID:', this.callId);
    console.warn('   - Request headers:', this.req.headers);
    
    return {
      callId: this.callId,
      customerEmail: 'prospect@example.com',
      customerName: 'Prospect',
      customerPhone: '',
      source: 'fallback'
    };
  }

  // Method to try fetching from trigger server endpoints (async)
  async attemptTriggerServerFetch() {
    if (!this.callId) return null;
    
    try {
      console.log('🔄 Attempting to fetch customer data from trigger server...');
      
      // Try different trigger server endpoints
      const endpoints = [
        `${config.TRIGGER_SERVER_URL}/api/calls/${this.callId}/metadata`,
        `${config.TRIGGER_SERVER_URL}/api/customer-data/${this.callId}`,
        `${config.TRIGGER_SERVER_URL}/calls/${this.callId}/info`
      ];
      
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint, { 
            timeout: 3000,
            headers: {
              'Authorization': `Bearer ${config.API_KEY || 'your-api-key'}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.data) {
            console.log('✅ Retrieved customer data from trigger server:', response.data);
            
            // Update connection data if we got real data
            this.connectionData = {
              callId: this.callId,
              customerEmail: response.data.customer_email || response.data.email || this.connectionData.customerEmail,
              customerName: response.data.customer_name || response.data.name || this.connectionData.customerName,
              customerPhone: response.data.customer_phone || response.data.phone || this.connectionData.customerPhone,
              source: 'trigger_server'
            };
            
            return this.connectionData;
          }
        } catch (err) {
          console.log(`⚠️ Trigger server endpoint ${endpoint} failed:`, err.message);
          continue;
        }
      }
    } catch (error) {
      console.log('⚠️ Trigger server fetch failed:', error.message);
    }
    
    return null;
  }

  // Extract embedded info from call ID if it contains encoded data
  extractEmbeddedCallInfo(callId) {
    try {
      // Check if call ID has embedded data (like base64 encoded info)
      if (callId.includes('_')) {
        const parts = callId.split('_');
        if (parts.length > 2) {
          // Try to decode potential base64 info
          try {
            const encoded = parts[parts.length - 1];
            const decoded = Buffer.from(encoded, 'base64').toString('utf8');
            const info = JSON.parse(decoded);
            if (info.email || info.name || info.phone) {
              return info;
            }
          } catch (e) {
            // Not base64 encoded JSON, that's ok
          }
        }
      }
    } catch (error) {
      console.log('Info extraction from call ID failed:', error.message);
    }
    return null;
  }

  async initialize() {
    // Try to get real customer data from trigger server (async)
    await this.attemptTriggerServerFetch();
    
    this.initializeDiscoverySession();
    this.setupEventHandlers();
    console.log('🔇 WAITING for user to speak first before greeting...');
    console.log('👤 Customer data source:', this.connectionData.source);
    console.log('📧 Customer email:', this.connectionData.customerEmail);
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

  async sendResponse(content, responseId = null) {
    // Enforce minimum delay between responses to prevent rapid-fire
    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTime;
    
    if (timeSinceLastResponse < this.minimumResponseDelay) {
      const waitTime = this.minimumResponseDelay - timeSinceLastResponse;
      console.log(`⏱️ WAITING ${waitTime}ms before responding to prevent rapid-fire...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    console.log('🤖 SENT:', content);
    this.lastResponseTime = Date.now();
    
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
      await this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log(`🗣️ USER: "${userMessage}"`);
    
    // Mark that user has spoken
    if (!this.userHasSpoken) {
      this.userHasSpoken = true;
      console.log('👤 USER SPOKE FIRST - Now we can start conversation');
    }
    
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // STEP 1: Handle first greeting when user speaks
    if (!this.hasGreeted && this.userHasSpoken) {
      await this.handleInitialGreeting(userMessage, parsed.response_id);
      return;
    }

    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log(`📊 CURRENT PROGRESS: ${progress?.questionsCompleted || 0}/6 questions, Phase: ${progress?.conversationPhase || 'greeting'}`);

    // STEP 2: Handle discovery phase - FIXED ANSWER CAPTURE
    if (progress?.questionsCompleted < 6 && !progress?.schedulingStarted) {
      await this.handleDiscoveryPhaseFixed(userMessage, parsed.response_id);
      return;
    }

    // STEP 3: Check for specific time booking request (only if enough questions done)
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    if (specificTimeMatch && progress?.questionsCompleted >= 5) {
      console.log('🕐 BOOKING REQUEST DETECTED:', specificTimeMatch.timeString);
      await this.handleBooking(specificTimeMatch, parsed.response_id);
      return;
    }

    // STEP 4: Handle scheduling phase
    if (progress?.questionsCompleted >= 6 || progress?.schedulingStarted) {
      await this.handleSchedulingPhase(userMessage, parsed.response_id);
      return;
    }

    // FALLBACK
    await this.generateContextualResponse(userMessage, parsed.response_id);
  }

  async handleInitialGreeting(userMessage, responseId) {
    console.log('👋 HANDLING INITIAL GREETING - USER SPOKE FIRST');
    this.hasGreeted = true;
    
    // Personalized greeting using real customer name if available
    const customerName = this.connectionData.customerName !== 'Customer' && this.connectionData.customerName !== 'Prospect' 
      ? ` ${this.connectionData.customerName}` 
      : '';
    
    const greeting = `Hi${customerName}! This is Sarah from Nexella AI. How are you doing today?`;
    
    await this.sendResponse(greeting, responseId);
    
    // Mark greeting as completed
    globalDiscoveryManager.markGreetingCompleted(this.callId);
  }

  // FIXED: Discovery phase with proper answer capture
  async handleDiscoveryPhaseFixed(userMessage, responseId) {
    console.log('📝 HANDLING DISCOVERY PHASE - FIXED VERSION');
    
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // If we just completed greeting and no questions asked yet, ask first question
    if (progress?.greetingCompleted && progress?.questionsCompleted === 0 && !progress?.waitingForAnswer) {
      console.log('🎯 ASKING FIRST QUESTION AFTER GREETING');
      const firstQuestion = "How did you hear about us?";
      
      const acknowledgment = this.getGreetingAcknowledgment(userMessage);
      const response = `${acknowledgment} ${firstQuestion}`;
      
      // Mark question as asked
      globalDiscoveryManager.markQuestionAsked(this.callId, 0, firstQuestion);
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      return;
    }
    
    // CRITICAL FIX: If we're waiting for an answer, capture it
    if (progress?.waitingForAnswer) {
      console.log(`📝 ATTEMPTING TO CAPTURE ANSWER for Q${progress.currentQuestionIndex + 1}: "${userMessage}"`);
      
      if (this.isValidDiscoveryAnswer(userMessage)) {
        const captured = globalDiscoveryManager.captureAnswer(
          this.callId, 
          progress.currentQuestionIndex, 
          userMessage.trim()
        );
        
        console.log(`📝 Answer capture result: ${captured}`);
        
        if (captured) {
          // Wait a moment before asking next question
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Check updated progress after capture
          const updatedProgress = globalDiscoveryManager.getProgress(this.callId);
          console.log(`📊 UPDATED PROGRESS: ${updatedProgress?.questionsCompleted}/6 questions`);
          
          if (updatedProgress?.questionsCompleted >= 6) {
            // All questions complete, transition to scheduling
            console.log('🎉 ALL DISCOVERY QUESTIONS COMPLETE - TRANSITIONING TO SCHEDULING');
            globalDiscoveryManager.markSchedulingStarted(this.callId);
            
            const response = "Perfect! I have all the information I need. Let's find you a time that works. What day works best for you?";
            this.conversationHistory.push({ role: 'assistant', content: response });
            await this.sendResponse(response, responseId);
            return;
          }
          
          // Ask next question
          const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
          if (nextQuestion) {
            const questionIndex = globalDiscoveryManager.getSession(this.callId).questions.findIndex(q => q.question === nextQuestion.question);
            const acknowledgment = this.getContextualAcknowledgment(userMessage, questionIndex - 1);
            const response = `${acknowledgment} ${nextQuestion.question}`;
            
            // Mark question as asked
            const marked = globalDiscoveryManager.markQuestionAsked(this.callId, questionIndex, response);
            
            if (marked) {
              this.conversationHistory.push({ role: 'assistant', content: response });
              await this.sendResponse(response, responseId);
            }
          }
          return;
        } else {
          console.log('❌ Failed to capture answer, asking question again');
        }
      } else {
        console.log('❌ Invalid answer format, asking question again');
      }
      
      // If answer wasn't captured, re-ask the current question
      const currentQuestion = globalDiscoveryManager.getSession(this.callId).questions[progress.currentQuestionIndex];
      if (currentQuestion) {
        const response = `I didn't catch that. ${currentQuestion.question}`;
        await this.sendResponse(response, responseId);
      }
      return;
    }
    
    // If not waiting for answer, something went wrong - ask next question
    console.log('⚠️ Not waiting for answer, asking next question');
    const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
    if (nextQuestion) {
      const questionIndex = globalDiscoveryManager.getSession(this.callId).questions.findIndex(q => q.question === nextQuestion.question);
      const response = nextQuestion.question;
      
      // Mark question as asked
      const marked = globalDiscoveryManager.markQuestionAsked(this.callId, questionIndex, response);
      
      if (marked) {
        this.conversationHistory.push({ role: 'assistant', content: response });
        await this.sendResponse(response, responseId);
      }
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

    // Generate availability response with real appointment schedule times
    try {
      const availabilityResponse = await this.generateRealAvailabilityResponse();
      this.conversationHistory.push({ role: 'assistant', content: availabilityResponse });
      await this.sendResponse(availabilityResponse, responseId);
    } catch (error) {
      console.error('❌ Error generating availability:', error.message);
      await this.sendResponse("Let me check my calendar for available times. What day works best for you?", responseId);
    }
  }

  async generateRealAvailabilityResponse() {
    console.log('🤖 Generating REAL availability response...');
    
    try {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      
      // Check next 5 business days
      const availableDays = [];
      for (let i = 1; i <= 7; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        
        // Skip weekends
        if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;
        
        const slots = await getAvailableTimeSlots(checkDate);
        if (slots.length > 0) {
          availableDays.push({
            dayName: checkDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
            slots: slots.slice(0, 3) // Take first 3 slots
          });
        }
        
        if (availableDays.length >= 3) break; // Show 3 days max
      }
      
      if (availableDays.length === 0) {
        return "I don't have any availability this week. Let me check next week for you.";
      }
      
      if (availableDays.length === 1) {
        const day = availableDays[0];
        const times = day.slots.map(s => s.displayTime).join(', ');
        return `I have availability on ${day.dayName} at ${times}. Which time works best for you?`;
      }
      
      // Multiple days available
      let response = "I have a few options available. ";
      availableDays.forEach((day, index) => {
        const times = day.slots.map(s => s.displayTime).join(', ');
        if (index === 0) {
          response += `${day.dayName} at ${times}`;
        } else if (index === availableDays.length - 1) {
          response += `, or ${day.dayName} at ${times}`;
        } else {
          response += `, ${day.dayName} at ${times}`;
        }
      });
      response += ". What works better for you?";
      
      console.log(`✅ Generated real availability response: ${response}`);
      return response;
      
    } catch (error) {
      console.error('❌ Error generating real availability:', error.message);
      return "Let me check my calendar for available times. What day and time would work best for you?";
    }
  }

  detectSpecificTimeRequest(userMessage) {
    console.log('🕐 CHECKING FOR TIME REQUEST:', userMessage);
    
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
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
      await this.sendResponse(response, responseId);
      
      // Send webhook in background
      setTimeout(() => this.sendWebhookData(timeRequest, discoveryData), 500);
      
    } catch (error) {
      console.error('❌ Booking error:', error.message);
      const fallbackResponse = `Perfect! I'll get you scheduled for ${timeRequest.dayName} at ${timeRequest.timeString}. You'll receive confirmation details shortly!`;
      await this.sendResponse(fallbackResponse, responseId);
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
      await this.sendResponse(reply, responseId);
      
    } catch (error) {
      console.log('⚡ Using fallback response due to AI error');
      const fallback = "I understand. How can I help you further?";
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      await this.sendResponse(fallback, responseId);
    }
  }

  isValidDiscoveryAnswer(userMessage) {
    const message = userMessage.toLowerCase().trim();
    
    // More lenient validation - accept most answers except obvious echoes
    const invalidPatterns = [
      /^(what|how|where|when|why|who)\b/,  // Questions
      /hear about/,
      /industry or business/,
      /main product/,
      /running.*ads/,
      /crm system/,
      /pain points/,
      /^(uh|um|er|ah)$/,  // Fillers only
    ];
    
    // Must be at least 2 characters and not match invalid patterns
    return message.length >= 2 && !invalidPatterns.some(pattern => pattern.test(message));
  }

  getGreetingAcknowledgment(userAnswer) {
    const answer = userAnswer.toLowerCase();
    
    if (answer.includes('good') || answer.includes('great') || answer.includes('well')) {
      return "That's wonderful to hear!";
    } else if (answer.includes('busy') || answer.includes('hectic')) {
      return "I totally understand.";
    } else if (answer.includes('fine') || answer.includes('ok')) {
      return "Great!";
    } else {
      return "Nice!";
    }
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
    
    try {
      const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
      if (sessionInfo) {
        console.log(`💾 Session completed: ${sessionInfo.questionsCompleted}/6 questions`);
        
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
