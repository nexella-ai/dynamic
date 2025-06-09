// src/handlers/WebSocketHandlerWithMemory.js - Enhanced with RAG Memory (FIXED)
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  generateAvailabilityResponse
} = require('../services/calendar/CalendarHelpers');
const { 
  sendSchedulingPreference
} = require('../services/webhooks/WebhookService');

// Safe import for getActiveCallsMetadata - may not exist
let getActiveCallsMetadata = null;
try {
  const webhookService = require('../services/webhooks/WebhookService');
  getActiveCallsMetadata = webhookService.getActiveCallsMetadata;
} catch (error) {
  console.log('⚠️ getActiveCallsMetadata not available - using fallback');
}

// Import Memory Service
let RAGMemoryService = null;
try {
  RAGMemoryService = require('../services/memory/RAGMemoryService');
} catch (error) {
  console.error('❌ RAGMemoryService not found - memory features disabled');
}

class WebSocketHandlerWithMemory {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    // Initialize RAG Memory Service if available
    this.memoryService = null;
    if (RAGMemoryService) {
      try {
        this.memoryService = new RAGMemoryService();
        console.log('🧠 Memory service initialized for call:', this.callId);
      } catch (error) {
        console.error('❌ Memory service initialization failed:', error.message);
      }
    }
    
    console.log('🔗 NEW CONNECTION WITH MEMORY - Call ID:', this.callId);
    
    // Get REAL customer data from all available sources
    this.connectionData = this.getRealCustomerData();
    
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a friendly professional assistant with memory of past interactions.

CONVERSATION FLOW:
1. GREETING: Wait for user to speak first, then greet (using memory if available) and ask first question
2. DISCOVERY: Ask these 6 questions ONE AT A TIME:
   - "How did you hear about us?"
   - "What industry or business are you in?" 
   - "What's your main product or service?"
   - "Are you currently running any ads?"
   - "Are you using any CRM system?"
   - "What are your biggest pain points or challenges?"
3. SCHEDULING: After ALL 6 questions, transition to scheduling

MEMORY USAGE:
- Reference previous conversations naturally when relevant
- Skip questions already answered in previous calls
- Acknowledge returning customers warmly
- Use business context from memory to personalize responses

CRITICAL RULES:
- WAIT for user to speak first before greeting
- Ask questions slowly, one at a time
- CAPTURE answers properly before moving to next question
- Be conversational but follow the exact question order
- Use memory to enhance, not replace, the conversation flow`
      }
    ];
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 2000;
    this.conversationContext = '';
    this.customerProfile = null;
    
    this.initialize();
  }

  async initialize() {
    // Load customer memory context
    await this.loadCustomerMemory();
    
    // Try to get real customer data from trigger server (async)
    await this.attemptTriggerServerFetch();
    
    this.initializeDiscoverySession();
    this.setupEventHandlers();
    
    console.log('🔇 WAITING for user to speak first before greeting...');
    console.log('👤 Customer data source:', this.connectionData.source);
    console.log('📧 Customer email:', this.connectionData.customerEmail);
    console.log('🧠 Memory context loaded:', this.conversationContext ? 'Yes' : 'No');
  }

  async loadCustomerMemory() {
    try {
      if (!this.memoryService) {
        console.log('⚠️ Memory service not available');
        return;
      }

      if (!this.connectionData.customerEmail || this.connectionData.customerEmail === 'prospect@example.com') {
        console.log('⚠️ No valid customer email for memory lookup');
        return;
      }

      console.log('🧠 Loading customer memory...');
      
      // Generate conversation context from memory
      this.conversationContext = await this.memoryService.generateConversationContext(
        this.connectionData.customerEmail,
        'customer interaction history'
      );
      
      // Get customer profile for personalization
      this.customerProfile = await this.memoryService.getCustomerContext(this.connectionData.customerEmail);
      
      if (this.conversationContext) {
        console.log('✅ Customer memory loaded:', this.conversationContext.substring(0, 100) + '...');
        
        // Add memory context to system message
        this.conversationHistory[0].content += `\n\nCUSTOMER MEMORY CONTEXT: ${this.conversationContext}`;
      }
      
    } catch (error) {
      console.error('❌ Error loading customer memory:', error.message);
    }
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
    
    // Method 2: Check active calls metadata from webhook service (FIXED)
    let activeCallsMetadata = null;
    try {
      if (getActiveCallsMetadata && typeof getActiveCallsMetadata === 'function') {
        activeCallsMetadata = getActiveCallsMetadata();
      } else {
        console.log('⚠️ getActiveCallsMetadata not available - skipping webhook metadata check');
      }
    } catch (error) {
      console.log('⚠️ Error getting active calls metadata:', error.message);
    }
    
    if (activeCallsMetadata && activeCallsMetadata.has && activeCallsMetadata.has(this.callId)) {
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
    
    // Fallback: Use minimal data but log comprehensive warning
    console.warn('⚠️ NO REAL CUSTOMER DATA FOUND - Using fallback data');
    return {
      callId: this.callId,
      customerEmail: 'prospect@example.com',
      customerName: 'Prospect',
      customerPhone: '',
      source: 'fallback'
    };
  }

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
      this.connectionStartTime = Date.now(); // Track call start time
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

    // STEP 2: Handle discovery phase with memory enhancement
    if (progress?.questionsCompleted < 6 && !progress?.schedulingStarted) {
      await this.handleDiscoveryPhaseWithMemory(userMessage, parsed.response_id);
      return;
    }

    // STEP 3: Check for specific time booking request (only if enough questions done)
    const specificTimeMatch = this.detectSpecificTimeRequest(userMessage);
    if (specificTimeMatch && progress?.questionsCompleted >= 5) {
      console.log('🕐 BOOKING REQUEST DETECTED:', specificTimeMatch.timeString);
      await this.handleBookingWithMemory(specificTimeMatch, parsed.response_id);
      return;
    }

    // STEP 4: Handle scheduling phase
    if (progress?.questionsCompleted >= 6 || progress?.schedulingStarted) {
      await this.handleSchedulingPhase(userMessage, parsed.response_id);
      return;
    }

    // FALLBACK - Use enhanced response with memory
    await this.generateEnhancedResponse(userMessage, parsed.response_id);
  }

  async handleInitialGreeting(userMessage, responseId) {
    console.log('👋 HANDLING INITIAL GREETING WITH MEMORY - USER SPOKE FIRST');
    this.hasGreeted = true;
    
    // Check if this is a returning customer
    const isReturningCustomer = this.customerProfile && this.customerProfile.totalInteractions > 0;
    
    let greeting;
    if (isReturningCustomer) {
      const customerName = this.connectionData.customerName !== 'Customer' && this.connectionData.customerName !== 'Prospect' 
        ? ` ${this.connectionData.customerName}` 
        : '';
      
      greeting = `Hi${customerName}! Great to hear from you again. This is Sarah from Nexella AI. How are things going?`;
      console.log('🔄 RETURNING CUSTOMER DETECTED - Using personalized greeting');
    } else {
      const customerName = this.connectionData.customerName !== 'Customer' && this.connectionData.customerName !== 'Prospect' 
        ? ` ${this.connectionData.customerName}` 
        : '';
      
      greeting = `Hi${customerName}! This is Sarah from Nexella AI. How are you doing today?`;
      console.log('✨ NEW CUSTOMER - Using standard greeting');
    }
    
    await this.sendResponse(greeting, responseId);
    
    // Mark greeting as completed
    globalDiscoveryManager.markGreetingCompleted(this.callId);
  }

  async handleDiscoveryPhaseWithMemory(userMessage, responseId) {
    console.log('📝 HANDLING DISCOVERY PHASE WITH MEMORY');
    
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // Check if we can skip questions based on memory
    if (this.customerProfile && progress?.questionsCompleted === 0 && !progress?.waitingForAnswer) {
      console.log('🧠 CHECKING MEMORY FOR PREVIOUS ANSWERS...');
      await this.handleMemoryBasedDiscovery(userMessage, responseId);
      return;
    }
    
    // Continue with regular discovery flow
    await this.handleDiscoveryPhaseFixed(userMessage, responseId);
  }

  async handleMemoryBasedDiscovery(userMessage, responseId) {
    if (!this.memoryService) {
      await this.handleRegularDiscovery(userMessage, responseId);
      return;
    }

    // Get previous business context from memory
    const businessMemories = await this.memoryService.getMemoriesByType(
      this.connectionData.customerEmail, 
      'business_context', 
      1
    );
    
    if (businessMemories.length > 0 && businessMemories[0].relevance !== 'very_low') {
      console.log('🎯 FOUND BUSINESS CONTEXT IN MEMORY - Acknowledging and starting with appropriate question');
      
      const acknowledgment = this.getGreetingAcknowledgment(userMessage);
      
      // Reference their business and ask a follow-up question
      const businessInfo = businessMemories[0].content;
      let response = `${acknowledgment} I remember we spoke about your ${businessInfo.includes('industry') ? 'business' : 'work'}. `;
      
      // Start with an appropriate question based on what we know
      if (businessInfo.includes('industry') || businessInfo.includes('business')) {
        // We know their industry, ask about current challenges
        response += "What are the biggest challenges you're facing right now?";
        
        // Mark as if we've answered the first few questions
        globalDiscoveryManager.markQuestionAsked(this.callId, 0, "How did you hear about us?");
        globalDiscoveryManager.captureAnswer(this.callId, 0, "Previous conversation");
        globalDiscoveryManager.markQuestionAsked(this.callId, 1, "What industry or business are you in?");
        globalDiscoveryManager.captureAnswer(this.callId, 1, "From memory: " + businessInfo);
        globalDiscoveryManager.markQuestionAsked(this.callId, 5, response);
      } else {
        // We have some info but not complete, start normally
        response += "How did you hear about us?";
        globalDiscoveryManager.markQuestionAsked(this.callId, 0, response);
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
    } else {
      // No useful memory, start normally
      await this.handleRegularDiscovery(userMessage, responseId);
    }
  }

  async handleRegularDiscovery(userMessage, responseId) {
    console.log('📝 NO USEFUL MEMORY FOUND - Starting normal discovery');
    const firstQuestion = "How did you hear about us?";
    
    const acknowledgment = this.getGreetingAcknowledgment(userMessage);
    const response = `${acknowledgment} ${firstQuestion}`;
    
    globalDiscoveryManager.markQuestionAsked(this.callId, 0, firstQuestion);
    
    this.conversationHistory.push({ role: 'assistant', content: response });
    await this.sendResponse(response, responseId);
  }

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
      await this.handleBookingWithMemory(specificTimeMatch, responseId);
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

  async handleBookingWithMemory(timeRequest, responseId) {
    try {
      console.log('🔄 ATTEMPTING APPOINTMENT BOOKING WITH MEMORY:', timeRequest.timeString);
      
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
        
        // Store successful booking in memory
        if (this.memoryService) {
          await this.handleSuccessfulBooking(timeRequest, discoveryData);
        }
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

  async handleSuccessfulBooking(timeRequest, discoveryData) {
    if (!this.memoryService) return;

    try {
      console.log('✅ BOOKING SUCCESSFUL - STORING COMPLETE INTERACTION MEMORY');
      
      // Enhanced conversation data for successful bookings
      const conversationData = {
        duration: this.calculateCallDuration(),
        questionsCompleted: 6,
        schedulingCompleted: true,
        appointmentScheduled: timeRequest.timeString,
        userSentiment: 'positive',
        callEndReason: 'successful_booking',
        outcome: 'appointment_booked'
      };
      
      // Store complete interaction in memory
      await this.memoryService.storeConversationMemory(
        this.callId,
        this.connectionData,
        conversationData,
        discoveryData
      );
      
    } catch (error) {
      console.error('❌ Error storing successful booking memory:', error.message);
    }
  }

  async generateEnhancedResponse(userMessage, responseId) {
    console.log('🤖 GENERATING ENHANCED RESPONSE WITH MEMORY CONTEXT');
    
    try {
      // Get relevant memories for context if memory service available
      let relevantMemories = [];
      if (this.memoryService) {
        relevantMemories = await this.memoryService.retrieveRelevantMemories(
          this.connectionData.customerEmail,
          userMessage,
          2
        );
      }
      
      // Add memory context to conversation history
      let enhancedSystemMessage = this.conversationHistory[0].content;
      
      if (relevantMemories.length > 0) {
        enhancedSystemMessage += '\n\nRELEVANT MEMORIES: ';
        relevantMemories.forEach(memory => {
          enhancedSystemMessage += `${memory.content}. `;
        });
      }
      
      // Create enhanced conversation history
      const enhancedHistory = [
        { role: 'system', content: enhancedSystemMessage },
        ...this.conversationHistory.slice(1)
      ];
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: enhancedHistory,
        temperature: 0.7,
        max_tokens: 150
      }, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
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

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED WITH MEMORY SAVE');
    
    try {
      // Get session info for memory storage
      const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
      
      if (sessionInfo && sessionInfo.questionsCompleted > 0 && this.memoryService) {
        console.log(`💾 Saving conversation to memory: ${sessionInfo.questionsCompleted}/6 questions`);
        
        // Prepare conversation data for memory storage
        const conversationData = {
          duration: this.calculateCallDuration(),
          questionsCompleted: sessionInfo.questionsCompleted,
          schedulingCompleted: sessionInfo.schedulingStarted || false,
          userSentiment: this.detectUserSentiment(),
          callEndReason: 'user_disconnect'
        };
        
        // Get discovery data
        const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
        
        // Store in RAG memory system
        await this.memoryService.storeConversationMemory(
          this.callId,
          this.connectionData,
          conversationData,
          discoveryData
        );
        
        // Send final webhook
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
    } catch (error) {
      console.error('Error in memory-enabled connection close handler:', error.message);
    }
  }

  // UTILITY METHODS FOR MEMORY

  calculateCallDuration() {
    // Calculate call duration in minutes
    const now = Date.now();
    const startTime = this.connectionStartTime || now;
    return Math.round((now - startTime) / 60000); // Convert to minutes
  }

  detectUserSentiment() {
    // Simple sentiment detection based on conversation
    // In production, you might use a more sophisticated sentiment analysis
    const lastUserMessages = this.conversationHistory
      .filter(msg => msg.role === 'user')
      .slice(-3)
      .map(msg => msg.content.toLowerCase())
      .join(' ');
    
    if (lastUserMessages.includes('great') || lastUserMessages.includes('perfect') || lastUserMessages.includes('thanks')) {
      return 'positive';
    } else if (lastUserMessages.includes('problem') || lastUserMessages.includes('difficult') || lastUserMessages.includes('frustrated')) {
      return 'negative';
    }
    
    return 'neutral';
  }

  // UTILITY METHODS FROM ORIGINAL HANDLER

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

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandlerWithMemory;
