// src/handlers/WebSocketHandlerWithMemory.js - STREAMLINED VERSION
const axios = require('axios');
const config = require('../config/environment');
const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');

// Import new managers
const ConversationFlowManager = require('../services/conversation/ConversationFlowManager');
const BookingManager = require('../services/booking/BookingManager');
const TimezoneHandler = require('../services/timezone/TimezoneHandler');

// Import Memory Service
let RAGMemoryService = null;
try {
  RAGMemoryService = require('../services/memory/RAGMemoryService');
} catch (error) {
  console.error('❌ RAGMemoryService not found');
}

class WebSocketHandlerWithMemory {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    // Initialize services
    this.memoryService = null;
    if (RAGMemoryService) {
      try {
        this.memoryService = new RAGMemoryService();
        console.log('🧠 Memory service initialized');
      } catch (error) {
        console.error('❌ Memory service initialization failed:', error.message);
      }
    }
    
    console.log('🔗 NEW CONNECTION - Call ID:', this.callId);
    
    // Connection data
    this.connectionData = {
      callId: this.callId,
      customerEmail: null,
      customerName: null,
      firstName: null,
      lastName: null,
      companyName: null,
      customerPhone: null,
      painPoint: null,
      typeformData: null
    };
    
    // Initialize managers (will be set after loading customer data)
    this.conversationManager = null;
    this.bookingManager = null;
    this.timezoneHandler = new TimezoneHandler();
    
    // Response control
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 1000; // 1 second minimum between responses
    this.greetingSent = false;
    this.connectionStartTime = Date.now();
    
    // Message tracking
    this.lastProcessedMessageId = null;
    this.messageQueue = [];
    this.isProcessingMessage = false;
    
    this.initialize();
  }

  async initialize() {
    console.log('🚀 Initializing streamlined handler...');
    
    // Load customer data
    await this.loadCustomerData();
    
    // Initialize managers with customer data
    this.conversationManager = new ConversationFlowManager(this.connectionData, this.memoryService);
    this.bookingManager = new BookingManager(this.connectionData);
    
    // Store Typeform data in memory if available
    if (this.connectionData.typeformData && this.memoryService) {
      await this.storeTypeformDataInMemory();
    }
    
    this.setupEventHandlers();
    
    // Send greeting immediately (within 500ms)
    setTimeout(async () => {
      if (!this.greetingSent) {
        await this.sendGreeting();
      }
    }, 500);
    
    console.log('✅ Initialization complete');
    console.log('👤 Customer:', this.connectionData.firstName || 'Unknown');
    console.log('🏢 Company:', this.connectionData.companyName || 'Unknown');
    console.log('🎯 Pain Point:', this.connectionData.painPoint || 'Unknown');
  }

  async loadCustomerData() {
    // Try to get data from various sources
    if (this.callId) {
      try {
        const endpoints = [
          `${config.TRIGGER_SERVER_URL}/api/typeform-data/${this.callId}`,
          `${config.TRIGGER_SERVER_URL}/api/get-call-data/${this.callId}`
        ];
        
        for (const endpoint of endpoints) {
          try {
            const response = await axios.get(endpoint, { timeout: 2000 });
            if (response.data) {
              this.extractCustomerData(response.data);
              if (this.connectionData.customerEmail && this.connectionData.firstName) {
                break;
              }
            }
          } catch (error) {
            // Continue to next endpoint
          }
        }
      } catch (error) {
        console.log('⚠️ Could not fetch customer data:', error.message);
      }
    }
    
    // Check global Typeform submission
    if (global.lastTypeformSubmission && !this.connectionData.customerEmail) {
      const typeform = global.lastTypeformSubmission;
      this.connectionData.customerEmail = typeform.email;
      this.connectionData.firstName = typeform.first_name;
      this.connectionData.lastName = typeform.last_name;
      this.connectionData.companyName = typeform.company_name || typeform.business_type;
      this.connectionData.painPoint = typeform.pain_point;
      this.connectionData.customerPhone = typeform.phone;
      this.connectionData.typeformData = typeform;
    }
    
    // Try to get from memory if we have email
    if (this.memoryService && this.connectionData.customerEmail) {
      await this.enhanceWithMemoryData();
    }
  }

  extractCustomerData(data) {
    const source = data.data || data;
    this.connectionData.customerEmail = source.email || source.customer_email || this.connectionData.customerEmail;
    this.connectionData.firstName = source.first_name || source.firstName || this.connectionData.firstName;
    this.connectionData.lastName = source.last_name || source.lastName || this.connectionData.lastName;
    this.connectionData.companyName = source.company_name || source.companyName || source.business_type || this.connectionData.companyName;
    this.connectionData.customerPhone = source.phone || source.customer_phone || this.connectionData.customerPhone;
    this.connectionData.painPoint = source.pain_point || source.struggling_with || this.connectionData.painPoint;
    
    if (!this.connectionData.customerName && (this.connectionData.firstName || this.connectionData.lastName)) {
      this.connectionData.customerName = `${this.connectionData.firstName || ''} ${this.connectionData.lastName || ''}`.trim();
    }
  }

  async enhanceWithMemoryData() {
    try {
      const memories = await this.memoryService.getMemoriesByType(
        this.connectionData.customerEmail,
        'typeform_submission',
        1
      );
      
      if (memories.length > 0) {
        const memory = memories[0].metadata;
        this.connectionData.firstName = this.connectionData.firstName || memory.first_name;
        this.connectionData.lastName = this.connectionData.lastName || memory.last_name;
        this.connectionData.companyName = this.connectionData.companyName || memory.company_name || memory.business_type;
        this.connectionData.painPoint = this.connectionData.painPoint || memory.pain_point;
        console.log('✅ Enhanced data from memory');
      }
    } catch (error) {
      console.log('⚠️ Could not enhance from memory:', error.message);
    }
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      if (parsed.interaction_type === 'response_required') {
        // Queue message for processing
        this.messageQueue.push(parsed);
        
        // Process queue if not already processing
        if (!this.isProcessingMessage) {
          await this.processMessageQueue();
        }
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
    }
  }

  async processMessageQueue() {
    if (this.isProcessingMessage || this.messageQueue.length === 0) {
      return;
    }
    
    this.isProcessingMessage = true;
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      await this.processUserMessage(message);
    }
    
    this.isProcessingMessage = false;
  }

  async processUserMessage(parsed) {
    // Prevent duplicate processing
    const messageId = parsed.response_id || Date.now();
    if (this.lastProcessedMessageId === messageId) {
      return;
    }
    this.lastProcessedMessageId = messageId;
    
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";
    
    console.log('🗣️ User said:', userMessage);
    
    // Send greeting if not sent yet
    if (!this.greetingSent && userMessage) {
      await this.sendGreeting(parsed.response_id);
      return;
    }
    
    // Get conversation state
    const conversationState = this.conversationManager.getState();
    console.log('📊 Conversation state:', conversationState);
    
    // Handle based on phase
    if (conversationState.bookingInProgress) {
      // Handle booking
      await this.handleBookingPhase(userMessage, parsed.response_id);
    } else if (conversationState.readyForScheduling) {
      // Check if user wants to schedule
      if (this.conversationManager.isSchedulingIntent(userMessage)) {
        this.conversationManager.transitionTo('booking');
        await this.handleBookingPhase(userMessage, parsed.response_id);
      } else {
        // Handle other responses
        await this.handleConversationPhase(userMessage, parsed.response_id);
      }
    } else {
      // Normal conversation flow
      await this.handleConversationPhase(userMessage, parsed.response_id);
    }
  }

  async sendGreeting(responseId = null) {
    if (this.greetingSent) return;
    
    this.greetingSent = true;
    const greeting = await this.conversationManager.generateQuickGreeting();
    await this.sendResponse(greeting, responseId || Date.now());
  }

  async handleConversationPhase(userMessage, responseId) {
    // Check if we need a scripted response
    const scriptedResponse = await this.conversationManager.getNextResponse(userMessage);
    
    if (scriptedResponse) {
      await this.sendResponse(scriptedResponse, responseId);
      
      // Process any queued responses
      this.processQueuedResponses();
    } else if (this.conversationManager.needsAIResponse(userMessage)) {
      // Generate AI response for complex questions
      const messages = [
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: userMessage }
      ];
      
      const aiResponse = await this.conversationManager.generateAIResponse(messages);
      await this.sendResponse(aiResponse, responseId);
    }
  }
  
  async processQueuedResponses() {
    // Check for queued responses periodically
    if (this.conversationManager.responseQueue.length > 0) {
      // Get the first queued response
      const queuedResponse = this.conversationManager.responseQueue.shift();
      
      // Wait a moment before sending
      setTimeout(async () => {
        if (typeof queuedResponse === 'function') {
          const response = await queuedResponse();
          await this.sendResponse(response, Date.now());
        } else {
          await this.sendResponse(queuedResponse, Date.now());
        }
        
        // Check for more queued responses
        this.processQueuedResponses();
      }, 2000);
    }
  }

  async handleBookingPhase(userMessage, responseId) {
    console.log('📅 Processing booking request:', userMessage);
    
    // Let BookingManager handle it
    const bookingResponse = await this.bookingManager.processBookingRequest(userMessage);
    
    if (bookingResponse) {
      await this.sendResponse(bookingResponse, responseId);
      
      // Check if booking is complete
      const bookingState = this.bookingManager.getState();
      if (bookingState.bookingCompleted) {
        this.conversationManager.markBookingComplete();
        
        // Send webhook
        await this.sendBookingWebhook();
      }
    } else {
      // Couldn't parse booking request, ask for clarification
      const response = "What day and time work best for you?";
      await this.sendResponse(response, responseId);
    }
  }

  getSystemPrompt() {
    return `You are Sarah from Nexella AI. 
Customer: ${this.connectionData.firstName || 'Guest'}
Company: ${this.connectionData.companyName || 'Unknown'}
Pain Point: ${this.connectionData.painPoint || 'Unknown'}

Keep responses under 25 words. Be conversational and helpful.`;
  }

  async sendResponse(content, responseId) {
    // Apply rate limiting
    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTime;
    
    if (timeSinceLastResponse < this.minimumResponseDelay) {
      const waitTime = this.minimumResponseDelay - timeSinceLastResponse;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    console.log('🤖 Sending:', content);
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId || Date.now()
    }));
    
    this.lastResponseTime = Date.now();
  }

  async storeTypeformDataInMemory() {
    if (!this.memoryService || !this.connectionData.customerEmail) return;
    
    try {
      const content = `Typeform submission: ${this.connectionData.firstName} from ${this.connectionData.companyName} struggling with: ${this.connectionData.painPoint}`;
      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `typeform_${this.callId}_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'typeform_submission',
          customer_email: this.connectionData.customerEmail,
          first_name: this.connectionData.firstName,
          last_name: this.connectionData.lastName,
          company_name: this.connectionData.companyName,
          pain_point: this.connectionData.painPoint,
          phone: this.connectionData.customerPhone,
          timestamp: new Date().toISOString(),
          call_id: this.callId,
          content: content
        }
      }]);
      
      console.log('✅ Typeform data stored in memory');
    } catch (error) {
      console.error('❌ Error storing Typeform data:', error.message);
    }
  }

  async sendBookingWebhook() {
    try {
      const bookingState = this.bookingManager.getState();
      const conversationState = this.conversationManager.getState();
      
      const webhookData = {
        first_name: this.connectionData.firstName,
        last_name: this.connectionData.lastName,
        company_name: this.connectionData.companyName,
        pain_point: this.connectionData.painPoint,
        appointment_booked: bookingState.bookingCompleted,
        user_timezone: this.timezoneHandler.getTimezoneName(this.bookingManager.bookingState.userTimezone),
        conversation_phase: conversationState.phase,
        booking_confirmed: bookingState.bookingCompleted
      };
      
      await sendSchedulingPreference(
        this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        bookingState.selectedDay || 'Appointment booked',
        this.callId,
        webhookData
      );
      
      console.log('✅ Booking webhook sent');
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  }

  async handleClose() {
    console.log('🔌 Connection closed');
    
    try {
      // Save conversation to memory if available
      if (this.memoryService && this.connectionData.customerEmail) {
        const conversationData = {
          duration: Math.round((Date.now() - this.connectionStartTime) / 60000),
          appointmentBooked: this.bookingManager?.getState().bookingCompleted || false,
          conversationPhase: this.conversationManager?.getState().phase || 'unknown'
        };
        
        await this.memoryService.storeConversationMemory(
          this.callId,
          this.connectionData,
          conversationData,
          { pain_point: this.connectionData.painPoint }
        );
      }
      
      // Send final webhook
      if (this.connectionData.customerEmail) {
        await sendSchedulingPreference(
          this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
          this.connectionData.customerEmail,
          this.connectionData.customerPhone,
          'Call ended',
          this.callId,
          {
            conversation_phase: this.conversationManager?.getState().phase || 'unknown',
            appointment_booked: this.bookingManager?.getState().bookingCompleted || false
          }
        );
      }
    } catch (error) {
      console.error('Error in close handler:', error);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }
}

module.exports = WebSocketHandlerWithMemory;
