// src/handlers/DynamicWebSocketHandler.js - Enhanced for Dynamic Companies
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
        bookingAttempted: false
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
      
      // Send ready signal
      this.ws.send(JSON.stringify({
        type: 'agent_ready',
        agentName: this.config.aiAgent.name,
        companyName: this.config.companyName,
        timestamp: new Date().toISOString()
      }));
      
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

COMPANY DETAILS:
- Name: ${this.config.companyName}
- Phone: ${this.config.companyPhone}
- Email: ${this.config.companyEmail}
- Website: ${this.config.website || 'Not specified'}

SERVICES OFFERED:
${Object.entries(this.config.services).map(([key, service]) => 
  `- ${service.name || key}: ${service.description || 'Available'}`
).join('\n')}

BUSINESS HOURS:
${this.formatBusinessHours()}

SERVICE AREAS:
- Primary: ${this.config.roofingSettings?.serviceAreas?.primary?.join(', ') || 'All areas'}
- Secondary: ${this.config.roofingSettings?.serviceAreas?.secondary?.join(', ') || 'Upon request'}

CERTIFICATIONS:
${this.config.roofingSettings?.certifications?.join(', ') || 'Industry certified'}

YOUR OBJECTIVES:
1. Greet warmly and build rapport
2. Understand their specific needs
3. Qualify using these questions:
${this.config.qualificationQuestions.map((q, i) => 
  `   ${i + 1}. ${q.question}`
).join('\n')}
4. Present relevant solutions based on their needs
5. Create appropriate urgency
6. Schedule appointments when appropriate

CONVERSATION GUIDELINES:
- Use the greeting template: "${this.config.aiAgent.greeting}"
- Be ${this.config.aiAgent.personality}
- Adapt responses to their industry if mentioned
- Use company-specific scripts when available

Remember: You represent ${this.config.companyName} with professionalism and expertise.`;
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
    
    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });
    
    // Extract customer information if available
    this.extractCustomerInfo(userMessage);
    
    // Generate response based on phase and company config
    let response = await this.generateContextualResponse(userMessage);
    
    // Send response
    await this.sendResponse(response, parsed.response_id);
    
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
    
    // Generate phase-specific response
    const contextPrompt = `
Current phase: ${phase}
Customer message: "${userMessage}"
Company scripts available: ${JSON.stringify(Object.keys(this.config.scripts))}

Generate an appropriate response following the company's tone and scripts.
If transitioning phases, indicate the new phase.
`;
    
    const messages = [
      ...this.conversationHistory,
      { role: 'system', content: contextPrompt }
    ];
    
    return await this.callOpenAI(messages);
  }
  
  detectSchedulingIntent(message) {
    const schedulingKeywords = [
      'schedule', 'book', 'appointment', 'available', 'meet',
      'call', 'time', 'when', 'calendar', 'free'
    ];
    
    const lower = message.toLowerCase();
    return schedulingKeywords.some(keyword => lower.includes(keyword));
  }
  
  async handleSchedulingRequest(userMessage) {
    if (!isCalendarInitialized() || !this.config.calendar) {
      return "I'd be happy to help schedule a time! Let me have someone from our team reach out to you directly to find a time that works best.";
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
      return "I'd love to schedule a time with you! Our scheduling team will reach out shortly with available options.";
    }
  }
  
  detectObjection(message) {
    const objectionMap = {
      'too_expensive': ['expensive', 'cost', 'price', 'afford', 'budget'],
      'getting_other_quotes': ['quotes', 'shopping', 'compare', 'other companies'],
      'not_urgent': ['not urgent', 'wait', 'later', 'think about it'],
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
      return configLoader.formatScript(objectionScript, this.conversationContext);
    }
    
    // Default objection handling
    return "I completely understand your concern. Let me address that for you...";
  }
  
  updateConversationPhase(userMessage, response) {
    const currentPhase = this.conversationContext.phase;
    
    // Simple phase progression logic
    if (currentPhase === 'greeting' && this.conversationHistory.length > 4) {
      this.conversationContext.phase = 'discovery';
    } else if (currentPhase === 'discovery' && this.conversationContext.customerData.email) {
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
  
  async callOpenAI(messages, maxTokens = 150) {
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
          timeout: 10000
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
