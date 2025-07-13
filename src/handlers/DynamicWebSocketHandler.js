// src/handlers/DynamicWebSocketHandler.js - FIXED VERSION WITH ERROR HANDLING
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
    
    // CRITICAL: Track if greeting was sent
    this.greetingSent = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 800; // Reduced to 0.8 seconds for faster responses
    
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
        waitingForAnswer: false
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
      
      // DON'T send ready signal - wait for user to speak first
      
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
    // Generate dynamic system prompt based on company config
    return `You are ${this.config.aiAgent.name}, ${this.config.aiAgent.role} at ${this.config.companyName}.

PERSONALITY: ${this.config.aiAgent.personality}

CRITICAL INSTRUCTIONS:
1. Give SHORT, CONCISE responses - maximum 2-3 sentences
2. Ask ONE question at a time - NEVER multiple questions
3. Wait for the customer's answer before asking the next question
4. Use natural conversation flow
5. Respond QUICKLY and NATURALLY

GREETING: "${this.config.aiAgent.greeting}"

CONVERSATION FLOW:
1. Greet ONCE when they speak
2. Ask how you can help
3. When they state their need, ask ONE qualifying question
4. Continue with one question at a time
5. After 2-3 questions max, offer to schedule

COMPANY DETAILS:
- Name: ${this.config.companyName}
- Phone: ${this.config.companyPhone}
- Services: ${Object.keys(this.config.services).join(', ')}

Remember: Be conversational, ask ONE thing at a time, keep responses SHORT.`;
  }
  
  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
    this.ws.on('pong', () => {
      console.log('🏓 Pong received');
    });
    
    // Ping to keep connection alive (important for Render)
    this.pingInterval = setInterval(() => {
      if (this.connectionActive && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000); // Every 30 seconds
  }
  
  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      // Process immediately if response required
      if (parsed.interaction_type === 'response_required') {
        // Process directly without queue for faster response
        await this.processUserMessage(parsed);
      } else {
        // Queue other message types
        this.messageQueue.push(parsed);
        if (!this.processingMessage) {
          await this.processMessageQueue();
        }
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error);
      this.ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format',
        message: error.message
      }));
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
      
      // Extract customer information if available
      this.extractCustomerInfo(userMessage);
      
      // CRITICAL: Handle greeting first
      if (!this.greetingSent) {
        this.greetingSent = true;
        // Use the simple greeting from config
        const greeting = this.config.aiAgent.greeting || "Hi! This is Mike from Half Price Roof. How can I help you today?";
        await this.sendResponse(greeting, parsed.response_id);
        this.conversationContext.phase = 'discovery';
        this.lastResponseTime = Date.now();
        return;
      }
      
      // Generate response based on phase and company config
      let response = await this.generateContextualResponse(userMessage);
      
      // Send response
      await this.sendResponse(response, parsed.response_id);
      this.lastResponseTime = Date.now();
      
      // Check if we should transition phases
      this.updateConversationPhase(userMessage, response);
      
    } catch (error) {
      console.error('❌ Error in processUserMessage:', error);
      // Send a fallback response if there's an error
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
    
    // Extract name (simple pattern)
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
    
    // Check if user is still saying hello
    if (lowerMessage.includes('hello') && this.conversationContext.currentQuestionIndex < 0) {
      return "I can help you with any roofing needs. What's going on with your roof?";
    }
    
    // Check for service keywords
    if (phase === 'discovery' || phase === 'greeting') {
      const serviceKeywords = {
        'leak': 'I can definitely help with that leak. Is it actively leaking right now?',
        'replace': 'We specialize in complete roof replacements. How old is your current roof?',
        'repair': 'We handle all types of roof repairs. What kind of damage are you seeing?',
        'inspection': 'Our free inspection will give you a complete assessment. When would you like to schedule it?',
        'emergency': 'We have 24/7 emergency crews available. Is there active water coming in?',
        'quote': 'I\'d be happy to get you a quote. What type of roofing work do you need?'
      };
      
      for (const [keyword, response] of Object.entries(serviceKeywords)) {
        if (lowerMessage.includes(keyword)) {
          this.conversationContext.phase = 'qualification';
          this.conversationContext.currentQuestionIndex = 0;
          return response;
        }
      }
    }
    
    // Handle qualification questions ONE AT A TIME
    if ((phase === 'qualification' || phase === 'discovery') && this.config.qualificationQuestions) {
      // If we haven't started questions yet, ask the first one
      if (this.conversationContext.currentQuestionIndex === -1) {
        this.conversationContext.currentQuestionIndex = 0;
        this.conversationContext.waitingForAnswer = true;
        const firstQuestion = this.config.qualificationQuestions[0];
        return firstQuestion.question;
      }
      
      // If waiting for answer, store it and ask next question
      if (this.conversationContext.waitingForAnswer) {
        const currentQuestion = this.config.qualificationQuestions[this.conversationContext.currentQuestionIndex];
        if (currentQuestion) {
          this.conversationContext.qualificationAnswers[currentQuestion.id] = userMessage;
        }
        
        // Move to next question
        this.conversationContext.currentQuestionIndex++;
        
        // Check if we have more questions
        if (this.conversationContext.currentQuestionIndex < this.config.qualificationQuestions.length) {
          const nextQuestion = this.config.qualificationQuestions[this.conversationContext.currentQuestionIndex];
          return nextQuestion.question;
        } else {
          // All questions answered, move to scheduling
          this.conversationContext.phase = 'scheduling';
          return "Perfect! Based on what you've told me, I can get you scheduled for a free inspection. What day works best for you this week?";
        }
      }
    }
    
    // Check for scheduling intent
    if (this.detectSchedulingIntent(userMessage)) {
      return await this.handleSchedulingRequest(userMessage);
    }
    
    // Default conversational response
    return "I can help you with that. What specific roofing issue are you experiencing?";
  }
  
  detectSchedulingIntent(message) {
    const schedulingKeywords = [
      'schedule', 'book', 'appointment', 'available', 'meet',
      'inspection', 'time', 'when', 'calendar', 'free',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'tomorrow', 'today'
    ];
    
    const lower = message.toLowerCase();
    return schedulingKeywords.some(keyword => lower.includes(keyword));
  }
  
  async handleSchedulingRequest(userMessage) {
    return "I'd be happy to schedule a free inspection! What day works best for you - I have openings Tuesday through Friday.";
  }
  
  updateConversationPhase(userMessage, response) {
    const currentPhase = this.conversationContext.phase;
    
    // Simple phase progression logic
    if (currentPhase === 'greeting') {
      this.conversationContext.phase = 'discovery';
    } else if (currentPhase === 'discovery' && this.conversationContext.currentQuestionIndex >= 0) {
      this.conversationContext.phase = 'qualification';
    } else if (currentPhase === 'qualification' && this.conversationContext.currentQuestionIndex >= this.config.qualificationQuestions.length) {
      this.conversationContext.phase = 'scheduling';
    }
    
    if (currentPhase !== this.conversationContext.phase) {
      console.log(`📊 Phase transition: ${currentPhase} → ${this.conversationContext.phase}`);
    }
  }
  
  async callOpenAI(messages, maxTokens = 50) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: messages,
          temperature: 0.7,
          max_tokens: maxTokens
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 3000 // Reduced timeout for faster responses
        }
      );
      
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API error:', error);
      return "I can help you with that. What's your main concern?";
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
  
  async handleConfigUpdate(message) {
    try {
      console.log('🔄 Updating configuration dynamically');
      
      // Reload configuration
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      
      // Update conversation context
      this.conversationContext.companyName = this.config.companyName;
      this.conversationContext.agentName = this.config.aiAgent.name;
      
      // Update system prompt
      this.conversationHistory[0] = {
        role: 'system',
        content: this.generateSystemPrompt()
      };
      
      this.ws.send(JSON.stringify({
        type: 'config_updated',
        success: true,
        message: 'Configuration updated successfully'
      }));
      
    } catch (error) {
      this.ws.send(JSON.stringify({
        type: 'config_update_error',
        error: error.message
      }));
    }
  }
  
  async handleAvailabilityRequest(message) {
    try {
      const { date } = message;
      const slots = await getAvailableTimeSlots(new Date(date));
      
      this.ws.send(JSON.stringify({
        type: 'availability_response',
        date: date,
        slots: slots,
        company: this.config.companyName
      }));
    } catch (error) {
      this.ws.send(JSON.stringify({
        type: 'availability_error',
        error: error.message
      }));
    }
  }
  
  async handleClose() {
    console.log(`🔌 Connection closed for ${this.config?.companyName || this.companyId}`);
    
    this.connectionActive = false;
    
    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    // Save conversation data
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
        duration: Date.now() - this.connectionStartTime,
        timestamp: new Date().toISOString()
      };
      
      // Send to webhook if configured
      if (this.conversationContext.customerData.email) {
        await sendSchedulingPreference(
          this.conversationContext.customerData.name || 'Unknown',
          this.conversationContext.customerData.email,
          this.conversationContext.customerData.phone || '',
          'Call ended',
          this.callId,
          {
            company: this.config.companyName,
            phase_reached: this.conversationContext.phase,
            qualification_data: this.conversationContext.qualificationAnswers
          }
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
