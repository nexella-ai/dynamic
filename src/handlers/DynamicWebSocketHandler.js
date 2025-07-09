// src/handlers/DynamicWebSocketHandler.js
const axios = require('axios');
const configLoader = require('../services/config/ConfigurationLoader');

class DynamicWebSocketHandler {
  constructor(ws, req, companyId) {
    this.ws = ws;
    this.req = req;
    this.companyId = companyId;
    this.config = null;
    
    // Extract call ID from URL
    const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
    this.callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
    
    // Initialize handler with company config
    this.initialize();
  }
  
  async initialize() {
    try {
      // Load company configuration
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      
      console.log(`🏢 Initialized handler for ${this.config.companyName}`);
      console.log(`🤖 AI Agent: ${this.config.aiAgent.name}`);
      console.log(`📞 Call ID: ${this.callId}`);
      
      // Set up conversation context with dynamic config
      this.conversationContext = {
        companyName: this.config.companyName,
        agentName: this.config.aiAgent.name,
        agentRole: this.config.aiAgent.role,
        services: this.config.services,
        businessHours: this.config.businessHours,
        customerData: {},
        qualificationAnswers: {},
        phase: 'greeting'
      };
      
      // Initialize conversation history with dynamic system prompt
      this.conversationHistory = [
        {
          role: 'system',
          content: this.generateSystemPrompt()
        }
      ];
      
      this.setupEventHandlers();
      
    } catch (error) {
      console.error('❌ Failed to initialize handler:', error);
      this.ws.close();
    }
  }
  
  generateSystemPrompt() {
    return `You are ${this.config.aiAgent.name}, a ${this.config.aiAgent.role} at ${this.config.companyName}.

PERSONALITY: ${this.config.aiAgent.personality}

COMPANY DETAILS:
- Name: ${this.config.companyName}
- Services: ${Object.keys(this.config.services).map(s => this.config.services[s].name || s).join(', ')}
- Certifications: ${this.config.roofingSettings.certifications.join(', ')}
- Service Areas: ${this.config.roofingSettings.serviceAreas.primary.join(', ')}

YOUR OBJECTIVES:
1. Build rapport using their name and understanding their roofing concerns
2. Identify their specific roofing issue (leak, storm damage, age, etc.)
3. Qualify them using our qualification questions
4. Present our relevant solution based on their needs
5. Create urgency based on their situation
6. Book an inspection appointment

CONVERSATION FLOW:
- Start with warm greeting using their first name
- Ask about their roofing concerns
- Use the qualification questions naturally in conversation
- Match their pain point to our solutions
- Handle objections using the provided scripts
- Book appointment when they show interest

Remember: You're talking to homeowners who need roofing help. Be empathetic, professional, and helpful.`;
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
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }
  
  async processUserMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    console.log(`🗣️ ${this.conversationContext.customerData.firstName || 'Customer'}: ${userMessage}`);
    
    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });
    
    // Determine response based on conversation phase
    let response = '';
    
    switch (this.conversationContext.phase) {
      case 'greeting':
        response = await this.handleGreeting(userMessage);
        break;
      case 'discovery':
        response = await this.handleDiscovery(userMessage);
        break;
      case 'qualification':
        response = await this.handleQualification(userMessage);
        break;
      case 'solution':
        response = await this.handleSolution(userMessage);
        break;
      case 'objection':
        response = await this.handleObjection(userMessage);
        break;
      case 'scheduling':
        response = await this.handleScheduling(userMessage);
        break;
      default:
        response = await this.generateAIResponse(userMessage);
    }
    
    // Send response
    await this.sendResponse(response, parsed.response_id);
  }
  
  async handleGreeting(userMessage) {
    // Use dynamic greeting from config
    const greeting = configLoader.formatScript(
      this.config.aiAgent.greeting,
      {
        firstName: this.conversationContext.customerData.firstName || 'there'
      }
    );
    
    this.conversationContext.phase = 'discovery';
    return greeting;
  }
  
  async handleDiscovery(userMessage) {
    // Check for roofing issue mentions
    const painPointKeywords = {
      'leak': ['leak', 'water', 'drip', 'wet', 'moisture'],
      'storm_damage': ['storm', 'hail', 'wind', 'damage', 'insurance'],
      'old_roof': ['old', 'replace', 'worn', 'age', 'years']
    };
    
    let detectedPainPoint = null;
    for (const [painPoint, keywords] of Object.entries(painPointKeywords)) {
      if (keywords.some(keyword => userMessage.toLowerCase().includes(keyword))) {
        detectedPainPoint = painPoint;
        break;
      }
    }
    
    if (detectedPainPoint) {
      this.conversationContext.painPoint = detectedPainPoint;
      this.conversationContext.phase = 'qualification';
      
      // Get dynamic acknowledgment script
      const script = this.config.scripts.painPoints[detectedPainPoint];
      return script.acknowledgment + " Let me ask you a few quick questions to better understand your situation.";
    }
    
    // Ask about their roofing needs
    return "I'd be happy to help! What's going on with your roof that brought you to us today?";
  }
  
  async handleQualification(userMessage) {
    // Get next unanswered question
    const unansweredQuestion = this.config.qualificationQuestions.find(
      q => !this.conversationContext.qualificationAnswers[q.id]
    );
    
    if (unansweredQuestion) {
      // Store answer to previous question if any
      const previousQuestion = this.getCurrentQuestion();
      if (previousQuestion) {
        this.conversationContext.qualificationAnswers[previousQuestion.id] = userMessage;
      }
      
      // Ask next question
      return unansweredQuestion.question;
    }
    
    // All questions answered, move to solution
    this.conversationContext.phase = 'solution';
    return this.presentSolution();
  }
  
  presentSolution() {
    const painPoint = this.conversationContext.painPoint || 'general';
    const script = this.config.scripts.painPoints[painPoint];
    
    if (script) {
      return script.solution + " " + script.urgency;
    }
    
    // Default solution
    return `Based on what you've told me, I'd recommend scheduling a free inspection. 
    Our certified technicians will assess your roof and provide you with a detailed report 
    and multiple options. Would you like to schedule that?`;
  }
  
  async handleObjection(userMessage) {
    // Detect common objections
    const objectionTypes = {
      'too_expensive': ['expensive', 'cost', 'price', 'afford', 'budget'],
      'getting_other_quotes': ['quotes', 'other', 'compare', 'shopping'],
      'not_urgent': ['not urgent', 'wait', 'later', 'think about'],
      'bad_experience': ['bad experience', 'burned', 'trust', 'scammed']
    };
    
    for (const [objection, keywords] of Object.entries(objectionTypes)) {
      if (keywords.some(keyword => userMessage.toLowerCase().includes(keyword))) {
        const response = configLoader.formatScript(
          this.config.scripts.objectionHandling[objection],
          this.conversationContext
        );
        return response;
      }
    }
    
    // No specific objection detected
    return "I understand your concerns. What specifically would help you feel more comfortable moving forward?";
  }
  
  async handleScheduling(userMessage) {
    // Check for scheduling intent
    if (userMessage.toLowerCase().includes('yes') || 
        userMessage.toLowerCase().includes('schedule') ||
        userMessage.toLowerCase().includes('book')) {
      
      // Get available slots based on company config
      const slots = await this.getAvailableSlots();
      
      if (slots.length > 0) {
        const slotOptions = slots.slice(0, 3).map(s => s.displayTime).join(', ');
        return `Great! I have ${slotOptions} available. Which works best for you?`;
      }
    }
    
    return "Would you like to schedule a free roof inspection?";
  }
  
  async getAvailableSlots() {
    // This would integrate with the calendar system
    // Using company-specific settings
    const leadTime = this.config.calendar.leadTime;
    const duration = this.config.calendar.appointmentDuration;
    const bufferTime = this.config.calendar.bufferTime;
    
    // Mock implementation
    const slots = [];
    const startDate = new Date();
    startDate.setHours(startDate.getHours() + leadTime);
    
    for (let i = 0; i < 5; i++) {
      const slotDate = new Date(startDate);
      slotDate.setDate(slotDate.getDate() + i);
      
      const dayName = slotDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const dayHours = this.config.businessHours.days[dayName];
      
      if (dayHours && dayHours.isOpen) {
        slots.push({
          startTime: slotDate.toISOString(),
          displayTime: slotDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric',
            hour: 'numeric',
            hour12: true
          })
        });
      }
    }
    
    return slots;
  }
  
  async generateAIResponse(userMessage) {
    // Use OpenAI with company context
    const messages = [
      ...this.conversationHistory,
      {
        role: 'system',
        content: `Remember: You work for ${this.config.companyName}. 
        Current phase: ${this.conversationContext.phase}.
        Customer pain point: ${this.conversationContext.painPoint || 'unknown'}.
        Use the company's tone and scripts when appropriate.`
      }
    ];
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: messages,
        temperature: 0.7,
        max_tokens: 150
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.choices[0].message.content;
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 ${this.config.aiAgent.name}: ${content}`);
    
    this.conversationHistory.push({ role: 'assistant', content });
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId || Date.now()
    }));
  }
  
  getCurrentQuestion() {
    // Find the last asked question
    const answeredIds = Object.keys(this.conversationContext.qualificationAnswers);
    const lastAnsweredIndex = this.config.qualificationQuestions.findIndex(
      q => q.id === answeredIds[answeredIds.length - 1]
    );
    
    if (lastAnsweredIndex >= 0 && lastAnsweredIndex < this.config.qualificationQuestions.length - 1) {
      return this.config.qualificationQuestions[lastAnsweredIndex + 1];
    }
    
    return null;
  }
  
  async handleClose() {
    console.log(`🔌 Connection closed for ${this.config.companyName}`);
    
    // Save conversation data
    await this.saveConversationData();
  }
  
  async saveConversationData() {
    // Save to CRM or database based on company config
    const conversationData = {
      companyId: this.companyId,
      callId: this.callId,
      customerData: this.conversationContext.customerData,
      qualificationAnswers: this.conversationContext.qualificationAnswers,
      painPoint: this.conversationContext.painPoint,
      phase: this.conversationContext.phase,
      timestamp: new Date().toISOString()
    };
    
    // Save based on CRM config
    if (this.config.crm.provider) {
      await this.saveToCRM(conversationData);
    }
    
    console.log('💾 Conversation data saved');
  }
  
  async saveToCRM(data) {
    // Implement CRM-specific save logic
    console.log(`Saving to ${this.config.crm.provider}`);
  }
  
  handleError(error) {
    console.error(`❌ WebSocket Error for ${this.config.companyName}:`, error);
  }
}

module.exports = DynamicWebSocketHandler;
