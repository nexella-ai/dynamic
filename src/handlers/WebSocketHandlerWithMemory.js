// src/handlers/WebSocketHandlerWithMemory.js - COMPLETE WITH ANTI-LOOP CALENDAR BOOKING AND INTELLIGENT MEMORY
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  generateAvailabilityResponse,
  isCalendarInitialized
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

// Import Appointment Booking Memory
let AppointmentBookingMemory = null;
try {
  AppointmentBookingMemory = require('../services/memory/AppointmentBookingMemory');
} catch (error) {
  console.log('⚠️ AppointmentBookingMemory not found - intelligent booking disabled');
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
    
    // Initialize Appointment Booking Memory
    this.bookingMemory = null;
    if (this.memoryService && AppointmentBookingMemory) {
      try {
        this.bookingMemory = new AppointmentBookingMemory();
        console.log('📅 Booking memory initialized for intelligent appointment detection');
      } catch (error) {
        console.error('❌ Booking memory initialization failed:', error.message);
      }
    }
    
    console.log('🔗 NEW CONNECTION WITH MEMORY - Call ID:', this.callId);
    console.log('📅 Calendar Status:', isCalendarInitialized() ? 'ENABLED ✅' : 'DISABLED ⚠️');
    
    // CRITICAL: Anti-loop state management for calendar booking
    this.appointmentBooked = false; // Prevents multiple booking attempts
    this.bookingInProgress = false; // Prevents concurrent booking attempts
    this.lastBookingAttempt = 0; // Track last booking attempt
    this.bookingCooldown = 10000; // 10 second cooldown between booking attempts
    
    // Response tracking to prevent loops
    this.responsesSent = [];
    this.maxResponsesPerMinute = 10;
    
    // Calendar booking state tracking
    this.calendarBookingState = {
      hasDetectedBookingRequest: false,
      bookingConfirmed: false,
      lastBookingResponse: null,
      bookingResponseSent: false,
      lastAppointmentMatch: null
    };
    
    // FIXED: Get REAL customer data aggressively from all sources
    this.connectionData = this.getRealCustomerDataAggressively();
    
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

CRITICAL APPOINTMENT BOOKING RULES:
- When customer specifies a day AND time (like "Tuesday at 10 AM"), IMMEDIATELY book it
- Say: "Perfect! I'm booking you for [day] at [time] Arizona time right now."
- Then confirm: "Your appointment is confirmed for [day] at [time] Arizona time. You'll receive a calendar invitation shortly!"
- Do NOT ask for confirmation - just book it immediately
- Do NOT offer alternatives unless the specific time is unavailable
- ALWAYS mention they'll receive a calendar invitation at their email

SCHEDULING APPROACH:
- Our business hours are 8 AM to 4 PM Arizona time (MST), Monday through Friday
- When suggesting times, use proper Arizona times: 8:00 AM, 9:00 AM, 10:00 AM, 11:00 AM, 1:00 PM, 2:00 PM, 3:00 PM
- When customer specifies a day and time, book the appointment immediately
- Always confirm Arizona timezone in booking confirmations

MEMORY USAGE:
- Reference previous conversations naturally when relevant
- Skip questions already answered in previous calls
- Acknowledge returning customers warmly
- Use business context from memory to personalize responses

CALENDAR INTEGRATION:
- We have automatic Google Calendar booking enabled
- When booking appointments, customers receive automatic calendar invitations with meeting links
- Always confirm the email address where they'll receive the invitation
- Meeting links are generated automatically for each appointment

CRITICAL RULES:
- WAIT for user to speak first before greeting
- Ask questions slowly, one at a time
- CAPTURE answers properly before moving to next question
- Be conversational but follow the exact question order
- Use memory to enhance, not replace, the conversation flow
- When they specify a time, book it IMMEDIATELY without asking for confirmation
- Always mention calendar invitation delivery

KEEP IT SHORT AND FOCUSED.`
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
    // FIXED: Try much harder to get real customer data
    await this.attemptRealDataRetrieval();
    
    // Load customer memory context
    await this.loadCustomerMemory();
    
    this.initializeDiscoverySession();
    this.setupEventHandlers();
    
    console.log('🔇 WAITING for user to speak first before greeting...');
    console.log('👤 Customer data source:', this.connectionData.source);
    console.log('📧 Customer email:', this.connectionData.customerEmail);
    console.log('🧠 Memory context loaded:', this.conversationContext ? 'Yes' : 'No');
    console.log('📅 Calendar integration:', isCalendarInitialized() ? 'ENABLED ✅' : 'DISABLED ⚠️');
  }

  // AGGRESSIVE: Try multiple methods to get real customer data
  async attemptRealDataRetrieval() {
    console.log('🔍 ATTEMPTING TO GET REAL CUSTOMER DATA...');
    
    // Method 1: Extract from URL
    const urlParts = this.req.url.split('?');
    if (urlParts.length > 1) {
      const urlParams = new URLSearchParams(urlParts[1]);
      const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
      const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
      const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
      
      if (emailFromUrl && emailFromUrl !== 'prospect@example.com') {
        console.log('✅ GOT REAL DATA FROM URL PARAMS');
        this.connectionData = {
          callId: this.callId,
          customerEmail: emailFromUrl,
          customerName: nameFromUrl || 'Customer',
          customerPhone: phoneFromUrl || '',
          source: 'url_params'
        };
        return;
      }
    }
    
    // Method 2: Check global storage
    if (global.lastCustomerData && global.lastCustomerData.email !== 'prospect@example.com') {
      console.log('✅ Using data from global storage:', global.lastCustomerData);
      this.connectionData = {
        callId: this.callId,
        customerEmail: global.lastCustomerData.email,
        customerName: global.lastCustomerData.name || '',
        customerPhone: global.lastCustomerData.phone || '',
        source: 'global_storage'
      };
      
      if (this.connectionData.customerEmail && this.connectionData.customerEmail !== 'prospect@example.com') {
        console.log('✅ Using real email from global storage:', this.connectionData.customerEmail);
        return;
      }
    }
    
    // Method 3: Check active calls metadata
    if (getActiveCallsMetadata && typeof getActiveCallsMetadata === 'function') {
      try {
        const activeCallsMetadata = getActiveCallsMetadata();
        if (activeCallsMetadata && activeCallsMetadata.has && activeCallsMetadata.has(this.callId)) {
          const callMetadata = activeCallsMetadata.get(this.callId);
          console.log('📞 Using active calls metadata:', callMetadata);
          
          this.connectionData = {
            callId: this.callId,
            customerEmail: callMetadata.customer_email || callMetadata.email || '',
            customerName: callMetadata.customer_name || callMetadata.name || '',
            customerPhone: callMetadata.customer_phone || callMetadata.phone || callMetadata.to_number || '',
            source: 'active_calls_metadata'
          };
          
          if (this.connectionData.customerEmail && this.connectionData.customerEmail !== 'prospect@example.com') {
            console.log('✅ Using real email from active calls:', this.connectionData.customerEmail);
            return;
          }
        }
      } catch (error) {
        console.log('❌ Error checking active calls metadata:', error.message);
      }
    }
    
    // Method 4: Extract from URL parameters
    const urlParams = new URLSearchParams(this.req.url.split('?')[1] || '');
    const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
    const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
    const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
    
    if (emailFromUrl && emailFromUrl !== 'prospect@example.com') {
      console.log('📧 Using email from URL parameters:', emailFromUrl);
      this.connectionData = {
        callId: this.callId,
        customerEmail: emailFromUrl,
        customerName: nameFromUrl || 'Customer',
        customerPhone: phoneFromUrl || '',
        source: 'url_parameters'
      };
      return;
    }
    
    // LAST RESORT: Create a placeholder but don't use fallback email
    console.warn('⚠️ NO REAL CUSTOMER DATA FOUND - Using minimal placeholder');
    this.connectionData = {
      callId: this.callId,
      customerEmail: null, // Don't use fallback email
      customerName: 'Customer',
      customerPhone: '',
      source: 'no_data_found'
    };
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
    return callIdMatch ? `call_${callIdMatch[1]}` : `call_${Date.now()}`;
  }

  // FIXED: Get real customer data from all possible sources
  getRealCustomerDataAggressively() {
    console.log('🔎 AGGRESSIVE SEARCH FOR REAL CUSTOMER DATA');
    
    // Try URL parameters first
    const urlParams = new URLSearchParams(this.req.url.split('?')[1] || '');
    const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
    const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
    const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
    
    if (emailFromUrl && emailFromUrl !== 'prospect@example.com') {
      console.log('✅ Using data from URL parameters');
      return {
        callId: this.callId,
        customerEmail: emailFromUrl,
        customerName: nameFromUrl || 'Customer',
        customerPhone: phoneFromUrl || '',
        source: 'url_params'
      };
    }
    
    // Return minimal data without fallback email
    console.warn('⚠️ NO REAL CUSTOMER DATA FOUND - Will try to get from WebSocket messages');
    return {
      callId: this.callId,
      customerEmail: null, // No fallback email
      customerName: 'Customer',
      customerPhone: '',
      source: 'awaiting_websocket_data'
    };
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

  // NEW: Controlled response system with anti-loop protection
  async sendResponse(content, responseId = null) {
    const now = Date.now();
    
    // Anti-loop: Check response frequency
    this.responsesSent = this.responsesSent.filter(time => now - time < 60000); // Keep last minute
    
    if (this.responsesSent.length >= this.maxResponsesPerMinute) {
      console.log('🚫 ANTI-LOOP: Too many responses per minute');
      return;
    }
    
    // Track this response
    this.responsesSent.push(now);
    this.lastResponseTime = now;
    
    // Create response object
    const response = {
      response_id: responseId || Date.now(),
      content: content,
      content_complete: true,
      end_call: false
    };
    
    console.log(`🤖 SENDING: "${content.substring(0, 100)}..."`);
    
    try {
      this.ws.send(JSON.stringify(response));
    } catch (error) {
      console.error('❌ Error sending WebSocket response:', error.message);
    }
  }

  async handleMessage(message) {
    try {
      const parsed = JSON.parse(message);
      
      // Check for customer data in metadata and update if found
      if (parsed.call?.metadata) {
        // Try to extract customer data from metadata
        if (parsed.call.metadata && (!this.connectionData.customerEmail || this.connectionData.customerEmail === 'prospect@example.com')) {
          console.log('📞 Extracting customer data from WebSocket metadata:', JSON.stringify(parsed.call.metadata, null, 2));
          
          const email = parsed.call.metadata.customer_email || parsed.call.metadata.email;
          const name = parsed.call.metadata.customer_name || parsed.call.metadata.name;
          const phone = parsed.call.metadata.customer_phone || parsed.call.metadata.phone || parsed.call.to_number;
          
          if (email && email !== 'prospect@example.com') {
            this.connectionData.customerEmail = email;
            this.connectionData.customerName = name || 'Customer';
            this.connectionData.customerPhone = phone || '';
            this.connectionData.source = 'websocket_metadata';
            
            console.log(`✅ UPDATED with real customer data from WebSocket:`, {
              email: this.connectionData.customerEmail,
              name: this.connectionData.customerName,
              phone: this.connectionData.customerPhone
            });
          }
        }
        
        // Also check call.to_number for phone
        if (parsed.call.to_number && !this.connectionData.customerPhone) {
          this.connectionData.customerPhone = parsed.call.to_number;
          console.log(`✅ Got phone from call object: ${this.connectionData.customerPhone}`);
        }
      }
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      await this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  // FIXED: Process user messages with post-booking responsiveness
  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log(`🗣️ USER: "${userMessage}"`);
    
    // Mark that user has spoken
    if (!this.userHasSpoken) {
      this.userHasSpoken = true;
      this.connectionStartTime = Date.now();
      console.log('👤 USER SPOKE FIRST - Now we can start conversation');
    }
    
    // Anti-loop timing protection
    const now = Date.now();
    if (now - this.lastResponseTime < this.minimumResponseDelay) {
      console.log('⏱️ Response too soon - enforcing delay');
      return;
    }
    
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Handle first greeting when user speaks
    if (!this.hasGreeted && this.userHasSpoken) {
      await this.handleInitialGreeting(userMessage, parsed.response_id);
      return;
    }

    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log(`📊 CURRENT PROGRESS: ${progress?.questionsCompleted || 0}/6 questions, Phase: ${progress?.conversationPhase || 'greeting'}`);

    // FIXED: Check if we're in post-booking phase
    if (this.appointmentBooked) {
      console.log('📅 POST-BOOKING PHASE - Handling general questions');
      
      // Use RAG system to answer post-booking questions
      if (this.memoryService) {
        // Search project knowledge for relevant information
        try {
          const relevantMemories = await this.memoryService.retrieveRelevantMemories(
            this.connectionData.customerEmail,
            userMessage,
            3
          );
          
          // Generate response using memory context
          await this.generateEnhancedResponse(userMessage, parsed.response_id);
          return;
        } catch (error) {
          console.error('❌ Error using RAG system:', error.message);
        }
      }
      
      // Fallback to standard AI response if RAG fails
      await this.generateAIResponse(userMessage, parsed.response_id);
      return;
    }

    // Check for appointment booking during scheduling phase
    if (progress?.questionsCompleted >= 6 && !this.appointmentBooked && !this.bookingInProgress) {
      console.log('🎯 CHECKING FOR APPOINTMENT REQUEST IN SCHEDULING PHASE');
      const appointmentMatch = await this.detectSpecificAppointmentRequest(userMessage);
      if (appointmentMatch) {
        console.log('🚀 APPOINTMENT REQUEST DETECTED - EXECUTING IMMEDIATE BOOKING');
        console.log('📋 Appointment details:', appointmentMatch);
        
        // Immediately set flags to prevent loops
        this.bookingInProgress = true;
        this.calendarBookingState.hasDetectedBookingRequest = true;
        this.calendarBookingState.lastAppointmentMatch = appointmentMatch;
        
        await this.handleImmediateAppointmentBooking(appointmentMatch, parsed.response_id);
        return;
      } else {
        console.log('❌ NO APPOINTMENT MATCH FOUND for:', userMessage);
        console.log('🔍 Falling back to availability response');
      }
    }

    // Handle discovery phase with memory enhancement
    if (!progress?.allQuestionsCompleted) {
      await this.handleDiscoveryPhase(userMessage, parsed.response_id, progress);
    } else if (!this.appointmentBooked) {
      // We're in scheduling phase but no specific appointment detected
      await this.handleSchedulingPhase(userMessage, parsed.response_id);
    }
  }

  // NEW: Enhanced AI response generation with memory context
  async generateEnhancedResponse(userMessage, responseId) {
    console.log('🤖 GENERATING ENHANCED RESPONSE WITH MEMORY CONTEXT');
    
    try {
      // Get relevant memories for context if memory service available
      let relevantMemories = [];
      if (this.memoryService && this.connectionData.customerEmail) {
        relevantMemories = await this.memoryService.retrieveRelevantMemories(
          this.connectionData.customerEmail,
          userMessage,
          2
        );
      }
      
      // Add memory context to conversation history
      let enhancedSystemMessage = `You are Sarah from Nexella AI. The customer has already booked an appointment. 
Answer their questions helpfully using any relevant context from previous interactions.
Be conversational and helpful. If they ask about the process, products, or services, provide clear information.`;
      
      if (relevantMemories.length > 0) {
        enhancedSystemMessage += '\n\nRELEVANT CONTEXT: ';
        relevantMemories.forEach(memory => {
          enhancedSystemMessage += `${memory.content}. `;
        });
      }
      
      // Create enhanced conversation history
      const enhancedHistory = [
        { role: 'system', content: enhancedSystemMessage },
        ...this.conversationHistory.slice(1).slice(-10) // Keep last 10 messages for context
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
      const fallback = "I'd be happy to help! What would you like to know about our services?";
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      await this.sendResponse(fallback, responseId);
    }
  }

  async handleInitialGreeting(userMessage, responseId) {
    this.hasGreeted = true;
    
    // Get greeting acknowledgment and first question
    const session = globalDiscoveryManager.getSession(this.callId, this.connectionData);
    const firstQuestion = "How did you hear about us?";
    
    // Create personalized greeting based on memory
    let greeting = '';
    if (this.customerProfile && this.customerProfile.totalInteractions > 0) {
      greeting = `Hi! Welcome back! It's Sarah from Nexella AI. ${this.getGreetingAcknowledgment(userMessage)} `;
    } else {
      greeting = `Hi! I'm Sarah from Nexella AI. ${this.getGreetingAcknowledgment(userMessage)} `;
    }
    
    const response = `${greeting}${firstQuestion}`;
    
    // Mark question as asked
    globalDiscoveryManager.markQuestionAsked(this.callId, 0, firstQuestion);
    
    this.conversationHistory.push({ role: 'assistant', content: response });
    await this.sendResponse(response, responseId);
  }

  async handleDiscoveryPhase(userMessage, responseId, progress) {
    console.log('🔍 DISCOVERY PHASE - Processing user message');
    
    // If we're waiting for an answer, capture it
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
          const nextQuestionIndex = updatedProgress.currentQuestionIndex + 1;
          if (nextQuestionIndex < 6) {
            const nextQuestion = globalDiscoveryManager.getNextQuestion(this.callId, nextQuestionIndex);
            if (nextQuestion) {
              console.log(`📤 ASKING QUESTION ${nextQuestionIndex + 1}: ${nextQuestion}`);
              
              // Get contextual acknowledgment
              const acknowledgment = globalDiscoveryManager.getContextualAcknowledgment(
                this.callId,
                progress.currentQuestionIndex,
                userMessage
              );
              
              const response = `${acknowledgment} ${nextQuestion}`;
              
              // Mark question as asked
              globalDiscoveryManager.markQuestionAsked(this.callId, nextQuestionIndex, nextQuestion);
              
              this.conversationHistory.push({ role: 'assistant', content: response });
              await this.sendResponse(response, responseId);
            }
          }
        }
      }
    }
  }

  async handleSchedulingPhase(userMessage, responseId) {
    console.log('📅 SCHEDULING PHASE - Looking for appointment preferences');
    
    // Generate availability response
    const response = await this.generateSchedulingResponse(userMessage);
    this.conversationHistory.push({ role: 'assistant', content: response });
    await this.sendResponse(response, responseId);
  }

  async generateSchedulingResponse(userMessage) {
    const lowerMessage = userMessage.toLowerCase();
    
    // Check for day preferences
    if (lowerMessage.includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return await generateAvailabilityResponse(tomorrow);
    } else if (lowerMessage.includes('today')) {
      return await generateAvailabilityResponse(new Date());
    } else if (lowerMessage.includes('week')) {
      return "I have availability throughout the week. What day works best for you - Monday through Friday?";
    } else {
      // Default scheduling response
      return "What day works best for you this week? I have availability Monday through Friday, 8 AM to 4 PM Arizona time.";
    }
  }

  // FIXED: Immediate appointment booking with proper flag handling
  async handleImmediateAppointmentBooking(appointmentRequest, responseId) {
    try {
      const now = Date.now();
      
      // Check booking cooldown
      if (now - this.lastBookingAttempt < this.bookingCooldown) {
        console.log('🚫 Booking cooldown active - ignoring request');
        this.bookingInProgress = false;
        return;
      }
      
      this.lastBookingAttempt = now;
      
      console.log('🎯 PROCESSING IMMEDIATE APPOINTMENT BOOKING');
      
      // Check if time is within business hours
      if (!appointmentRequest.isBusinessHours) {
        const response = `I'd love to schedule you for ${appointmentRequest.dayName} at ${appointmentRequest.timeString}, but our business hours are 8 AM to 4 PM Arizona time. Would you like to pick a time between 8 AM and 4 PM instead?`;
        await this.sendResponse(response, responseId);
        this.bookingInProgress = false;
        return;
      }
      
      // Send immediate confirmation that we're booking
      const confirmationResponse = `Perfect! I'm booking you for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time right now...`;
      await this.sendResponse(confirmationResponse, responseId);
      
      // Small delay before actual booking
      setTimeout(async () => {
        try {
          const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
          
          const bookingResult = await autoBookAppointment(
            this.connectionData.customerName || 'Customer',
            this.connectionData.customerEmail,
            this.connectionData.customerPhone,
            appointmentRequest.dateTime,
            discoveryData
          );
          
          if (bookingResult.success) {
            // CRITICAL: Set appointmentBooked flag AFTER successful booking
            this.appointmentBooked = true;
            this.calendarBookingState.bookingConfirmed = true;
            
            // Send success message with invitation to continue conversation
            const successResponse = `Your appointment is confirmed for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time! You'll receive a calendar invitation at ${this.connectionData.customerEmail} shortly. Is there anything else you'd like to know about our services?`;
            
            await this.sendResponse(successResponse, `${responseId}_success`);
            
            console.log('✅ APPOINTMENT BOOKED SUCCESSFULLY');
            console.log('📧 Calendar invitation sent to:', this.connectionData.customerEmail);
            console.log('🔗 Meeting link:', bookingResult.meetingLink);
            console.log('📅 Event ID:', bookingResult.eventId);

            // Store successful booking in memory
            if (this.memoryService) {
              await this.handleSuccessfulBooking(appointmentRequest, discoveryData);
            }
            
            // Store successful pattern in booking memory for learning
            if (this.bookingMemory && !appointmentRequest.fromMemory) {
              await this.bookingMemory.storeSuccessfulBookingPattern(
                appointmentRequest.originalMatch,
                appointmentRequest,
                this.connectionData.customerEmail
              );
            }

            // Send success webhook with calendar details
            await this.sendBookingWebhook(appointmentRequest, discoveryData, bookingResult, 'success');

          } else {
            // Booking failed
            console.log('❌ CALENDAR BOOKING FAILED:', bookingResult.error);
            
            const failureResponse = `I apologize, but I couldn't book that time slot. ${bookingResult.message || 'Please try another time.'}`;
            await this.sendResponse(failureResponse, `${responseId}_failure`);
            
            this.appointmentBooked = false;
            
            // Store failed attempt for learning
            if (this.bookingMemory) {
              await this.bookingMemory.storeFailedBookingAttempt(
                appointmentRequest.originalMatch,
                bookingResult.error
              );
            }
            
            await this.sendBookingWebhook(appointmentRequest, discoveryData, null, 'failed');
          }
          
        } catch (bookingError) {
          console.error('❌ Calendar booking exception:', bookingError.message);
          
          const errorResponse = `I'm having trouble accessing the calendar right now. Let me make a note of your preference for ${appointmentRequest.dayName} at ${appointmentRequest.timeString}, and we'll confirm it shortly.`;
          await this.sendResponse(errorResponse, `${responseId}_error`);
          
          this.appointmentBooked = false;
          
          // Store failed attempt for learning
          if (this.bookingMemory) {
            await this.bookingMemory.storeFailedBookingAttempt(
              appointmentRequest.originalMatch,
              bookingError.message
            );
          }
          
          await this.sendBookingWebhook(appointmentRequest, discoveryData, null, 'error');
        } finally {
          // Always reset booking in progress
          this.bookingInProgress = false;
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error in immediate appointment booking:', error.message);
      this.bookingInProgress = false;
      this.appointmentBooked = false;
      
      // Fallback response
      const errorResponse = `Perfect! I'll get you scheduled for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time. You'll receive confirmation shortly.`;
      await this.sendResponse(errorResponse, `${responseId}_fallback`);
    }
  }

  // Enhanced appointment detection with booking memory
  async detectSpecificAppointmentRequest(userMessage) {
    console.log('🔍 DETECTING SPECIFIC APPOINTMENT REQUEST');
    
    // First, try booking memory if available
    if (this.bookingMemory) {
      try {
        const bookingIntelligence = await this.bookingMemory.getBookingIntelligence(userMessage);
        
        if (bookingIntelligence.confident) {
          console.log('🧠 BOOKING MEMORY MATCH:', bookingIntelligence);
          
          // Parse the suggested time
          const hour = parseInt(bookingIntelligence.suggestedTime.split(':')[0]);
          const minutes = parseInt(bookingIntelligence.suggestedTime.split(':')[1].split(' ')[0]);
          const period = bookingIntelligence.suggestedTime.includes('PM') ? 'pm' : 'am';
          
          let hour24 = hour;
          if (period === 'pm' && hour !== 12) hour24 += 12;
          if (period === 'am' && hour === 12) hour24 = 0;
          
          const targetDate = this.calculateTargetDate(bookingIntelligence.suggestedDay, hour24, minutes);
          
          return {
            dateTime: targetDate,
            dayName: bookingIntelligence.suggestedDay,
            timeString: bookingIntelligence.suggestedTime,
            originalMatch: userMessage,
            isBusinessHours: hour24 >= 8 && hour24 < 16,
            hour: hour24,
            fromMemory: true,
            confidence: bookingIntelligence.confidence
          };
        }
      } catch (error) {
        console.error('❌ Error using booking memory:', error.message);
      }
    }
    
    // Fall back to pattern matching
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(\d{1,2})\b/i
    ];

    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match) {
        console.log('📅 PATTERN MATCHED:', match[0]);
        return this.parseAppointmentRequest(match, pattern);
      }
    }
    
    return null;
  }

  parseAppointmentRequest(match, pattern) {
    try {
      let day, hour, minutes = 0, period = 'am';
      
      // Determine which pattern matched and extract components
      if (pattern.source.includes('(monday|tuesday')) {
        if (match[1].match(/\d/)) {
          // Pattern 2: Time first
          hour = parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3] || 'am';
          day = match[4];
        } else {
          // Pattern 1 or 3: Day first
          day = match[1];
          hour = parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4] || (hour >= 8 && hour <= 11 ? 'am' : hour >= 1 && hour <= 4 ? 'pm' : 'am');
        }
      }
      
      // Convert to 24-hour format
      let hour24 = hour;
      if (period.toLowerCase().includes('p') && hour !== 12) {
        hour24 += 12;
      } else if (period.toLowerCase().includes('a') && hour === 12) {
        hour24 = 0;
      }
      
      // Calculate target date
      const targetDate = this.calculateTargetDate(day, hour24, minutes);
      
      const displayHour = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
      const displayPeriod = hour24 >= 12 ? 'PM' : 'AM';
      
      const result = {
        dateTime: targetDate,
        dayName: day,
        timeString: `${displayHour}:${minutes.toString().padStart(2, '0')} ${displayPeriod}`,
        originalMatch: match[0],
        isBusinessHours: hour24 >= 8 && hour24 < 16,
        hour: hour24
      };
      
      console.log('✅ APPOINTMENT PARSING SUCCESSFUL:', result);
      return result;
      
    } catch (error) {
      console.error('❌ Error parsing appointment:', error.message);
      return null;
    }
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

  async sendBookingWebhook(appointmentRequest, discoveryData, bookingResult, status) {
    try {
      const webhookData = {
        name: this.connectionData.customerName || 'Customer',
        email: this.connectionData.customerEmail || '',
        phone: this.connectionData.customerPhone || '',
        preferredDay: appointmentRequest.dayName,
        preferredTime: appointmentRequest.timeString,
        call_id: this.callId,
        schedulingComplete: status === 'success',
        
        calendar_platform: 'google',
        calendar_booking: status === 'success',
        meeting_link: bookingResult?.meetingLink || '',
        event_link: bookingResult?.eventLink || '',
        event_id: bookingResult?.eventId || '',
        scheduled_time: appointmentRequest.dateTime.toISOString(),
        booking_method: 'automatic',
        booking_status: status,
        
        discovery_data: discoveryData || {}
      };
      
      await sendSchedulingPreference(
        webhookData.name,
        webhookData.email,
        webhookData.phone,
        `${webhookData.preferredDay} at ${webhookData.preferredTime}`,
        this.callId,
        discoveryData
      );
      
      console.log('✅ Booking webhook sent:', status);
    } catch (error) {
      console.error('❌ Error sending booking webhook:', error.message);
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

  async generateAIResponse(userMessage, responseId) {
    console.log('🤖 GENERATING AI RESPONSE');
    
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: this.conversationHistory.slice(-10), // Last 10 messages
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
      console.log('⚡ Using fallback response');
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
      
      if (sessionInfo && sessionInfo.questionsCompleted > 0 && this.memoryService && this.connectionData.customerEmail) {
        console.log(`💾 Saving conversation to memory: ${sessionInfo.questionsCompleted}/6 questions`);
        
        // Prepare conversation data for memory storage
        const conversationData = {
          duration: this.calculateCallDuration(),
          questionsCompleted: sessionInfo.questionsCompleted,
          schedulingCompleted: sessionInfo.schedulingStarted || false,
          userSentiment: this.detectUserSentiment(),
          callEndReason: 'user_disconnect',
          appointmentBooked: this.appointmentBooked || false
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

  async handleError(error) {
    console.error('❌ WebSocket error:', error.message);
  }

  // UTILITY METHODS FOR MEMORY

  calculateCallDuration() {
    const now = Date.now();
    const startTime = this.connectionStartTime || now;
    return Math.round((now - startTime) / 60000);
  }

  detectUserSentiment() {
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
    } else if (answer.includes('okay') || answer.includes('alright') || answer.includes('fine')) {
      return "Glad to hear you're doing okay.";
    } else if (answer.includes('bad') || answer.includes('not') || answer.includes('terrible')) {
      return "I'm sorry to hear that. Hopefully I can help make your day better.";
    } else {
      return "Thanks for taking my call!";
    }
  }

  isValidDiscoveryAnswer(answer) {
    if (!answer || answer.length < 2) return false;
    
    const schedulingKeywords = ['schedule', 'book', 'appointment', 'meet', 'available', 'calendar'];
    const lowerAnswer = answer.toLowerCase();
    
    return !schedulingKeywords.some(keyword => lowerAnswer.includes(keyword));
  }
}

module.exports = WebSocketHandlerWithMemory;
