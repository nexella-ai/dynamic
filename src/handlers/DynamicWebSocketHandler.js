// src/handlers/DynamicWebSocketHandler.js - FIXED VERSION
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
    this.minimumResponseDelay = 1500; // 1.5 seconds between responses
    
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

GREETING TEMPLATE: "${this.config.aiAgent.greeting}"

CONVERSATION FLOW:
1. Greet ONCE when they speak (use the greeting template)
2. Ask how you can help
3. When they state their need, ask ONE qualifying question
4. Continue with one question at a time
5. After 3-4 questions max, offer to schedule

COMPANY DETAILS:
- Name: ${this.config.companyName}
- Phone: ${this.config.companyPhone}
- Services: ${Object.keys(this.config.services).join(', ')}

Remember: Be conversational, ask ONE thing at a time, keep responses SHORT.`;
  }
  
  formatBusinessHours() {
    const days = this.config.businessHours.days;
    return Object.entries(days)
      .map(([day, hours]) => {
        if (!hours.isOpen) return `${day}: Closed`;
        return `${day}: ${hours.open} - ${hours.close}`;
      })
      .join('\n');
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
      
      // Queue message for processing
      this.messageQueue.push(parsed);
      
      // Process queue if not already processing
      if (!this.processingMessage) {
        await this.processMessageQueue();
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
        if (message.interaction_type === 'response_required') {
          await this.processUserMessage(message);
        } else if (message.type === 'update_config') {
          await this.handleConfigUpdate(message);
        } else if (message.type === 'get_availability') {
          await this.handleAvailabilityRequest(message);
        }
      } catch (error) {
        console.error('❌ Error processing message:', error);
      }
      
      // Small delay between messages
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.processingMessage = false;
  }
  
  async processUserMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    console.log(`🗣️ [${this.config.companyName}] User: ${userMessage}`);
    
    // CRITICAL: Apply response delay
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
      const greeting = configLoader.formatScript(this.config.aiAgent.greeting, {
        firstName: this.conversationContext.customerData.name || ''
      });
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
    // Use company-specific logic and scripts
    const phase = this.conversationContext.phase;
    
    // Check for scheduling intent
    if (this.detectSchedulingIntent(userMessage)) {
      return await this.handleSchedulingRequest(userMessage);
    }
    
    // Check for objections
    const objection = this.detectObjection(userMessage);
    if (objection) {
      return this.handleObjection(objection);
    }
    
    // Handle qualification questions ONE AT A TIME
    if (phase === 'discovery' && this.conversationContext.currentQuestionIndex < this.config.qualificationQuestions.length - 1) {
      // Check if we're waiting for an answer
      if (this.conversationContext.waitingForAnswer) {
        // Store the answer
        const currentQuestion = this.config.qualificationQuestions[this.conversationContext.currentQuestionIndex];
        this.conversationContext.qualificationAnswers[currentQuestion.id] = userMessage;
        this.conversationContext.waitingForAnswer = false;
      }
      
      // Move to next question
      this.conversationContext.currentQuestionIndex++;
      const nextQuestion = this.config.qualificationQuestions[this.conversationContext.currentQuestionIndex];
      this.conversationContext.waitingForAnswer = true;
      
      // Return just the question
      return nextQuestion.question;
    }
    
    // If all questions answered, move to solution/scheduling
    if (this.conversationContext.currentQuestionIndex >= this.config.qualificationQuestions.length - 1) {
      this.conversationContext.phase = 'solution';
      return "Great! Based on what you've told me, I can definitely help you. Let me check our schedule for a free inspection. What day works best for you this week?";
    }
    
    // Generate phase-specific response
    const contextPrompt = `
Current phase: ${phase}
Customer message: "${userMessage}"

Generate a SHORT response (1-2 sentences max) that addresses their concern.
If they mentioned a specific need, acknowledge it briefly.
DO NOT ask multiple questions.
`;
    
    const messages = [
      ...this.conversationHistory.slice(-5), // Only last 5 messages for context
      { role: 'system', content: contextPrompt }
    ];
    
    return await this.callOpenAI(messages);
  }
  
  detectSchedulingIntent(message) {
    const schedulingKeywords = [
      'schedule', 'book', 'appointment', 'available', 'meet',
      'inspection', 'time', 'when', 'calendar', 'free'
    ];
    
    const lower = message.toLowerCase();
    return schedulingKeywords.some(keyword => lower.includes(keyword));
  }
  
  async handleSchedulingRequest(userMessage) {
    if (!isCalendarInitialized() || !this.config.calendar) {
      return "I'd be happy to schedule a free inspection! What day works best for you this week?";
    }
    
    try {
      // Get available slots
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const slots = await getAvailableTimeSlots(tomorrow);
      
      if (slots.length > 0) {
        const slotOptions = slots.slice(0, 3).map(s => s.displayTime).join(', ');
        return `Great! I have the following times available: ${slotOptions}. Which works best for you?`;
      } else {
        return "I'd be happy to schedule a time! Let me check our availability and have someone reach out to you with options.";
      }
    } catch (error) {
      console.error('Error checking availability:', error);
      return "I'd love to schedule a free inspection! Our scheduling team will reach out shortly with available options.";
    }
  }
  
  detectObjection(message) {
    const objectionMap = {
      'too_expensive': ['expensive', 'cost', 'price', 'afford', 'budget'],
      'getting_quotes': ['quotes', 'shopping', 'compare', 'other companies'],
      'not_sure_need': ['not sure', 'maybe', 'think about', 'consider'],
      'bad_experience': ['bad experience', 'burned', 'trust', 'scammed']
    };
    
    const lower = message.toLowerCase();
    
    for (const [objection, keywords] of Object.entries(objectionMap)) {
      if (keywords.some(keyword => lower.includes(keyword))) {
        return objection;
      }
    }
    
    return null;
  }
  
  handleObjection(objectionType) {
    const objectionScript = this.config.scripts.objectionHandling[objectionType];
    if (objectionScript) {
      // Return just the first sentence to keep it short
      const firstSentence = objectionScript.split('.')[0] + '.';
      return firstSentence;
    }
    
    // Default objection handling
    return "I completely understand your concern.";
  }
  
  updateConversationPhase(userMessage, response) {
    const currentPhase = this.conversationContext.phase;
    
    // Simple phase progression logic
    if (currentPhase === 'greeting') {
      this.conversationContext.phase = 'discovery';
    } else if (currentPhase === 'discovery' && this.conversationContext.currentQuestionIndex >= 2) {
      this.conversationContext.phase = 'qualification';
    } else if (currentPhase === 'qualification' && Object.keys(this.conversationContext.qualificationAnswers).length >= 3) {
      this.conversationContext.phase = 'solution';
    } else if (currentPhase === 'solution' && this.detectSchedulingIntent(userMessage)) {
      this.conversationContext.phase = 'scheduling';
    }
    
    if (currentPhase !== this.conversationContext.phase) {
      console.log(`📊 Phase transition: ${currentPhase} → ${this.conversationContext.phase}`);
    }
  }
  
  async callOpenAI(messages, maxTokens = 50) { // Reduced tokens for shorter responses
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
          timeout: 5000
        }
      );
      
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API error:', error);
      return "I understand. Let me help you with that.";
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
