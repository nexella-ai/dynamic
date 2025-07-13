// src/handlers/DynamicWebSocketHandler.js - FIXED WITH RAPPORT & SCHEDULING
const axios = require('axios');
const configLoader = require('../services/config/ConfigurationLoader');
const { 
  autoBookAppointment, 
  getAvailableTimeSlots,
  isCalendarInitialized 
} = require('../services/calendar/CalendarHelpers');
const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');

class DynamicWebSocketHandler {
  constructor(ws, req, companyId) {
    this.ws = ws;
    this.req = req;
    this.companyId = companyId;
    this.config = null;
    
    // Extract call ID from URL
    const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
    this.callId = callIdMatch ? `call_${callIdMatch[1]}` : `call_${Date.now()}`;
    
    // Connection state
    this.connectionActive = true;
    this.messageQueue = [];
    this.processingMessage = false;
    
    // Conversation tracking
    this.greetingSent = false;
    this.rapportBuilt = false;
    this.ownershipAsked = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 800;
    
    // Scheduling state
    this.schedulingState = {
      inProgress: false,
      daySelected: null,
      timeSelected: null,
      attemptCount: 0
    };
    
    // Track connection start time
    this.connectionStartTime = Date.now();
    
    // Initialize handler
    this.initialize();
  }
  
  async initialize() {
    try {
      // Load company configuration
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      
      console.log(`🏢 Initialized handler for ${this.config.companyName}`);
      console.log(`🤖 AI Agent: ${this.config.aiAgent.name} (${this.config.aiAgent.role})`);
      console.log(`📞 Call ID: ${this.callId}`);
      
      // Initialize conversation context
      this.conversationContext = {
        companyName: this.config.companyName,
        agentName: this.config.aiAgent.name,
        agentRole: this.config.aiAgent.role,
        agentPersonality: this.config.aiAgent.personality,
        services: this.config.services,
        businessHours: this.config.businessHours,
        customerData: {},
        qualificationAnswers: {},
        phase: 'greeting',
        bookingAttempted: false,
        currentQuestionIndex: -1,
        waitingForAnswer: false,
        serviceType: null,
        propertyType: null,
        urgency: null,
        isOwner: null
      };
      
      // Initialize conversation history with dynamic system prompt
      this.conversationHistory = [
        {
          role: 'system',
          content: this.generateSystemPrompt()
        }
      ];
      
      // Setup event handlers
      this.setupEventHandlers();
      
    } catch (error) {
      console.error('❌ Failed to initialize handler:', error);
      this.ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to load company configuration',
        message: error.message
      }));
      this.ws.close(1011, 'Configuration error');
    }
  }
  
  generateSystemPrompt() {
    return `You are ${this.config.aiAgent.name}, ${this.config.aiAgent.role} at ${this.config.companyName}.

PERSONALITY: ${this.config.aiAgent.personality}

CRITICAL INSTRUCTIONS:
1. Build rapport first - respond to how they're doing, show empathy
2. Ask ONE question at a time - NEVER multiple questions
3. Keep responses short and natural (2-3 sentences max)
4. Show genuine interest and understanding

CONVERSATION FLOW:
1. Greet warmly when they speak
2. Build rapport - ask how they're doing or acknowledge their response
3. Understand their roofing need
4. Ask if they're the property owner
5. Ask 2-3 qualifying questions ONE at a time
6. Offer to schedule free inspection
7. When they give a day, confirm it and ask for time preference

IMPORTANT: When scheduling, if they say a day (like Friday), CONFIRM IT and ask what time works best.

COMPANY: ${this.config.companyName}
SERVICES: ${Object.keys(this.config.services).join(', ')}`;
  }
  
  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
    this.ws.on('pong', () => {
      console.log('🏓 Pong received');
    });
    
    // Ping to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.connectionActive && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }
  
  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      } else {
        this.messageQueue.push(parsed);
        if (!this.processingMessage) {
          await this.processMessageQueue();
        }
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  }
  
  async processMessageQueue() {
    if (this.processingMessage || this.messageQueue.length === 0) return;
    
    this.processingMessage = true;
    
    while (this.messageQueue.length > 0 && this.connectionActive) {
      const message = this.messageQueue.shift();
      
      try {
        if (message.type === 'update_config') {
          await this.handleConfigUpdate(message);
        } else if (message.type === 'get_availability') {
          await this.handleAvailabilityRequest(message);
        }
      } catch (error) {
        console.error('❌ Error processing message:', error);
      }
    }
    
    this.processingMessage = false;
  }
  
  async processUserMessage(parsed) {
    try {
      const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
      console.log(`🗣️ [${this.config.companyName}] User: ${userMessage}`);
      
      // Apply minimal delay for natural conversation
      const now = Date.now();
      const timeSinceLastResponse = now - this.lastResponseTime;
      if (timeSinceLastResponse < this.minimumResponseDelay) {
        const waitTime = this.minimumResponseDelay - timeSinceLastResponse;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Add to conversation history
      this.conversationHistory.push({ role: 'user', content: userMessage });
      
      // Extract customer information
      this.extractCustomerInfo(userMessage);
      
      // Generate and send response
      let response = await this.generateContextualResponse(userMessage);
      
      if (response) {
        await this.sendResponse(response, parsed.response_id);
        this.lastResponseTime = Date.now();
      }
      
    } catch (error) {
      console.error('❌ Error in processUserMessage:', error);
      await this.sendResponse("I understand. How can I help you with your roofing needs?", parsed.response_id);
    }
  }
  
  extractCustomerInfo(message) {
    // Extract email
    const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      this.conversationContext.customerData.email = emailMatch[0];
    }
    
    // Extract phone
    const phoneMatch = message.match(/(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/);
    if (phoneMatch) {
      this.conversationContext.customerData.phone = phoneMatch[0];
    }
    
    // Extract name
    const namePatterns = [
      /my name is ([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i,
      /i'm ([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i,
      /this is ([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i
    ];
    
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match) {
        this.conversationContext.customerData.name = match[1];
        break;
      }
    }
  }
  
  async generateContextualResponse(userMessage) {
    const phase = this.conversationContext.phase;
    const lowerMessage = userMessage.toLowerCase();
    
    // GREETING PHASE
    if (!this.greetingSent) {
      this.greetingSent = true;
      this.conversationContext.phase = 'rapport';
      return "Hi! This is Mike from Half Price Roof. How are you doing today?";
    }
    
    // RAPPORT BUILDING PHASE
    if (phase === 'rapport' && !this.rapportBuilt) {
      this.rapportBuilt = true;
      this.conversationContext.phase = 'discovery';
      
      // Respond appropriately to their greeting
      if (lowerMessage.includes('good') || lowerMessage.includes('fine') || lowerMessage.includes('ok')) {
        return "That's great to hear! How can I help you with your roofing needs today?";
      } else if (lowerMessage.includes('bad') || lowerMessage.includes('not')) {
        return "I'm sorry to hear that. Well, I'm here to help make at least your roofing situation better. What's going on with your roof?";
      } else {
        return "Thanks for taking my call! What can I help you with regarding your roof today?";
      }
    }
    
    // DISCOVERY PHASE - Understanding their need
    if (phase === 'discovery' && !this.conversationContext.serviceType) {
      // Check for service keywords
      if (lowerMessage.includes('replac') || lowerMessage.includes('new roof')) {
        this.conversationContext.serviceType = 'replacement';
        this.conversationContext.phase = 'qualification';
        return "I can definitely help with a roof replacement. Is this for your own property?";
      } else if (lowerMessage.includes('leak') || lowerMessage.includes('repair')) {
        this.conversationContext.serviceType = 'repair';
        this.conversationContext.phase = 'qualification';
        return "I understand you need a repair. Is this for your own property?";
      } else if (lowerMessage.includes('inspection') || lowerMessage.includes('check')) {
        this.conversationContext.serviceType = 'inspection';
        this.conversationContext.phase = 'qualification';
        return "A roof inspection is a smart choice. Is this for your own property?";
      } else {
        return "What type of roofing service are you looking for today?";
      }
    }
    
    // QUALIFICATION PHASE
    if (phase === 'qualification') {
      // Ask about ownership if not asked
      if (!this.ownershipAsked) {
        this.ownershipAsked = true;
        this.conversationContext.waitingForAnswer = true;
        this.conversationContext.currentQuestionIndex = -1; // Special index for ownership
        return null; // Already asked in discovery phase
      }
      
      // Process ownership answer
      if (this.conversationContext.currentQuestionIndex === -1 && this.conversationContext.waitingForAnswer) {
        this.conversationContext.isOwner = lowerMessage.includes('yes') || lowerMessage.includes('yeah') || 
                                          lowerMessage.includes('own') || !lowerMessage.includes('no');
        this.conversationContext.waitingForAnswer = false;
        this.conversationContext.currentQuestionIndex = 0;
        
        if (!this.conversationContext.isOwner) {
          return "No problem! Are you authorized to make decisions about roofing work for this property?";
        } else {
          // Ask first real qualification question
          const firstQuestion = this.config.qualificationQuestions[0];
          this.conversationContext.waitingForAnswer = true;
          return firstQuestion.question;
        }
      }
      
      // Handle qualification questions
      if (this.conversationContext.waitingForAnswer && this.conversationContext.currentQuestionIndex >= 0) {
        // Store the answer
        const currentQuestion = this.config.qualificationQuestions[this.conversationContext.currentQuestionIndex];
        if (currentQuestion) {
          this.conversationContext.qualificationAnswers[currentQuestion.id] = userMessage;
          
          // Special handling for urgency
          if (currentQuestion.id === 'urgency') {
            if (lowerMessage.includes('asap') || lowerMessage.includes('emergency') || 
                lowerMessage.includes('urgent') || lowerMessage.includes('leak')) {
              this.conversationContext.urgency = 'urgent';
            }
          }
        }
        
        // Move to next question
        this.conversationContext.currentQuestionIndex++;
        
        // Check if we have more questions
        if (this.conversationContext.currentQuestionIndex < this.config.qualificationQuestions.length) {
          const nextQuestion = this.config.qualificationQuestions[this.conversationContext.currentQuestionIndex];
          this.conversationContext.waitingForAnswer = true;
          return nextQuestion.question;
        } else {
          // All questions answered, move to scheduling
          this.conversationContext.phase = 'scheduling';
          this.conversationContext.waitingForAnswer = false;
          
          if (this.conversationContext.urgency === 'urgent') {
            return "I understand this is urgent. Let me get you scheduled right away for a free inspection. We have availability as soon as tomorrow. What day works best for you?";
          } else {
            return "Perfect! Based on what you've told me, I can get you scheduled for a free inspection. What day works best for you this week?";
          }
        }
      }
    }
    
    // SCHEDULING PHASE
    if (phase === 'scheduling' || this.schedulingState.inProgress) {
      return await this.handleSchedulingPhase(userMessage);
    }
    
    // Default response
    return "I can help you with that. What's your main concern with your roof?";
  }
  
  async handleSchedulingPhase(userMessage) {
    const lowerMessage = userMessage.toLowerCase();
    
    // Check if they mentioned a day
    const dayMatch = lowerMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i);
    
    if (dayMatch && !this.schedulingState.daySelected) {
      this.schedulingState.daySelected = dayMatch[0];
      this.schedulingState.inProgress = true;
      
      // Capitalize first letter
      const day = this.schedulingState.daySelected.charAt(0).toUpperCase() + this.schedulingState.daySelected.slice(1);
      
      return `Great! I have ${day} available. What time works best for you - morning or afternoon?`;
    }
    
    // Check if they mentioned a time preference
    if (this.schedulingState.daySelected && !this.schedulingState.timeSelected) {
      if (lowerMessage.includes('morning') || lowerMessage.includes('am')) {
        this.schedulingState.timeSelected = 'morning';
        return `Perfect! I'll schedule you for ${this.schedulingState.daySelected} morning. Our inspector will call you 30 minutes before arrival. What's the best phone number to reach you?`;
      } else if (lowerMessage.includes('afternoon') || lowerMessage.includes('pm')) {
        this.schedulingState.timeSelected = 'afternoon';
        return `Perfect! I'll schedule you for ${this.schedulingState.daySelected} afternoon. Our inspector will call you 30 minutes before arrival. What's the best phone number to reach you?`;
      } else if (lowerMessage.match(/\d/)) {
        // They gave a specific time
        this.schedulingState.timeSelected = userMessage;
        return `Perfect! I'll schedule you for ${this.schedulingState.daySelected} at ${userMessage}. Our inspector will call you 30 minutes before arrival. What's the best phone number to reach you?`;
      } else {
        return "Do you prefer morning or afternoon?";
      }
    }
    
    // Check if they provided phone number
    if (this.schedulingState.daySelected && this.schedulingState.timeSelected) {
      const phoneMatch = userMessage.match(/(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/);
      if (phoneMatch) {
        this.conversationContext.customerData.phone = phoneMatch[0];
        return `Got it! I have you scheduled for ${this.schedulingState.daySelected} ${this.schedulingState.timeSelected}. Can I get your name for the appointment?`;
      } else if (this.conversationContext.customerData.name) {
        return `Excellent ${this.conversationContext.customerData.name}! You're all set for ${this.schedulingState.daySelected} ${this.schedulingState.timeSelected}. We'll send you a confirmation and our inspector will call 30 minutes before arrival. Is there anything else I can help you with?`;
      }
    }
    
    // Fallback
    this.schedulingState.attemptCount++;
    if (this.schedulingState.attemptCount > 3) {
      return "Let me have our scheduling team reach out to you directly to find a time that works best. What's the best number to reach you?";
    }
    
    return "What day works best for you for a free inspection?";
  }
  
  updateConversationPhase(userMessage, response) {
    const currentPhase = this.conversationContext.phase;
    
    if (currentPhase !== this.conversationContext.phase) {
      console.log(`📊 Phase transition: ${currentPhase} → ${this.conversationContext.phase}`);
    }
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 [${this.config.companyName}] ${this.config.aiAgent.name}: ${content}`);
    
    this.conversationHistory.push({ role: 'assistant', content });
    
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        content: content,
        content_complete: true,
        actions: [],
        response_id: responseId || Date.now(),
        agent_name: this.config.aiAgent.name,
        company: this.config.companyName
      }));
    }
  }
  
  async handleClose() {
    console.log(`🔌 Connection closed for ${this.config?.companyName || this.companyId}`);
    
    this.connectionActive = false;
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    await this.saveConversationData();
  }
  
  async saveConversationData() {
    try {
      const conversationData = {
        companyId: this.companyId,
        companyName: this.config?.companyName,
        callId: this.callId,
        customerData: this.conversationContext.customerData,
        qualificationAnswers: this.conversationContext.qualificationAnswers,
        phase: this.conversationContext.phase,
        schedulingComplete: this.schedulingState.daySelected && this.schedulingState.timeSelected,
        scheduledDay: this.schedulingState.daySelected,
        scheduledTime: this.schedulingState.timeSelected,
        isOwner: this.conversationContext.isOwner,
        duration: Date.now() - this.connectionStartTime,
        timestamp: new Date().toISOString()
      };
      
      if (this.conversationContext.customerData.email) {
        await sendSchedulingPreference(
          this.conversationContext.customerData.name || 'Unknown',
          this.conversationContext.customerData.email,
          this.conversationContext.customerData.phone || '',
          this.schedulingState.daySelected || 'Call ended',
          this.callId,
          conversationData
        );
      }
      
      console.log('💾 Conversation data saved');
    } catch (error) {
      console.error('Error saving conversation data:', error);
    }
  }
  
  handleError(error) {
    console.error(`❌ WebSocket Error for ${this.config?.companyName || this.companyId}:`, error);
  }
}

module.exports = DynamicWebSocketHandler;
