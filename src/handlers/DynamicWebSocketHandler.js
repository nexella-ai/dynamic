// src/handlers/DynamicWebSocketHandler.js - FAST & NATURAL WITH OPENAI
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
    
    // Extract call ID
    const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
    this.callId = callIdMatch ? `call_${callIdMatch[1]}` : `call_${Date.now()}`;
    
    // Connection state
    this.connectionActive = true;
    this.conversationStarted = false;
    
    // Conversation tracking
    this.conversationContext = {
      phase: 'greeting',
      customerData: {},
      serviceNeeded: null,
      isOwner: null,
      urgency: null,
      schedulingStarted: false,
      daySelected: null,
      timeSelected: null
    };
    
    // Conversation history for OpenAI
    this.conversationHistory = [];
    
    // Response timing
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 500; // 0.5 seconds
    
    this.initialize();
  }
  
  async initialize() {
    try {
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      
      console.log(`🏢 Initialized handler for ${this.config.companyName}`);
      console.log(`🤖 AI Agent: ${this.config.aiAgent.name}`);
      console.log(`📞 Call ID: ${this.callId}`);
      
      // Initialize with a focused system prompt
      this.conversationHistory = [{
        role: 'system',
        content: `You are Mike, a friendly roofing specialist at Half Price Roof in Cincinnati.

PERSONALITY: Be warm, conversational, and helpful. Sound like a real person, not a robot.

CRITICAL RULES:
1. Keep responses SHORT - max 1-2 sentences
2. Use casual, natural language with contractions
3. Show empathy and build rapport
4. Ask ONE thing at a time

CONVERSATION FLOW:
1. First greeting: "Hey there! This is Mike from Half Price Roof. How's your day going so far?"
2. Respond warmly to how they're doing, then ask about their roofing needs
3. Once you understand their need, ask: "Is this for your own home?"
4. Ask about urgency: "Do you need someone out there ASAP or just planning ahead?"
5. Offer scheduling: "What day works best for you?"
6. When they pick a day, ask: "Morning or afternoon?"
7. Get their first name for the appointment
8. Confirm the appointment and optionally ask for email

IMPORTANT: Be conversational and natural. If someone says hello multiple times or seems confused, just acknowledge them warmly and move forward.`
      }];
      
      this.setupEventHandlers();
      
    } catch (error) {
      console.error('❌ Failed to initialize handler:', error);
      this.ws.close(1011, 'Configuration error');
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
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }
  
  async processUserMessage(parsed) {
    try {
      const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
      console.log(`🗣️ User: ${userMessage}`);
      
      // Apply minimal delay for natural conversation
      const now = Date.now();
      const timeSinceLastResponse = now - this.lastResponseTime;
      if (timeSinceLastResponse < this.minimumResponseDelay) {
        const waitTime = this.minimumResponseDelay - timeSinceLastResponse;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Add user message to history
      this.conversationHistory.push({ role: 'user', content: userMessage });
      
      // Generate response using OpenAI
      const response = await this.generateResponse();
      
      // Send response
      await this.sendResponse(response, parsed.response_id);
      this.lastResponseTime = Date.now();
      
    } catch (error) {
      console.error('❌ Error processing message:', error);
      await this.sendResponse("Sorry, I didn't catch that. What can I help you with regarding your roof?", parsed.response_id);
    }
  }
  
  async generateResponse() {
    try {
      // Add context about current phase
      const phaseContext = this.getPhaseContext();
      
      const messages = [
        ...this.conversationHistory,
        {
          role: 'system',
          content: phaseContext
        }
      ];
      
      // Make OpenAI API call with tight parameters for speed
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4-turbo-preview', // Faster than regular GPT-4
          messages: messages.slice(-7), // Only last 7 messages for speed
          temperature: 0.7,
          max_tokens: 60, // Short responses
          presence_penalty: 0.3, // Reduce repetition
          frequency_penalty: 0.3
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 3000 // 3 second timeout
        }
      );
      
      const aiResponse = response.data.choices[0].message.content.trim();
      
      // Add to conversation history
      this.conversationHistory.push({ role: 'assistant', content: aiResponse });
      
      // Update phase based on response
      this.updatePhase(aiResponse);
      
      return aiResponse;
      
    } catch (error) {
      console.error('OpenAI API error:', error.message);
      
      // Fallback responses based on phase
      return this.getFallbackResponse();
    }
  }
  
  getPhaseContext() {
    const phase = this.conversationContext.phase;
    
    switch(phase) {
      case 'greeting':
        if (!this.conversationStarted) {
          this.conversationStarted = true;
          return 'Start with: "Hey there! This is Mike from Half Price Roof. How\'s your day going so far?"';
        }
        return 'Build rapport by responding warmly to how they\'re doing, then ask what\'s going on with their roof.';
        
      case 'discovery':
        return 'Find out what roofing service they need (repair, replacement, or inspection). Once clear, ask if it\'s their own home.';
        
      case 'ownership':
        return 'You need to know if they own the property. Ask: "Is this for your own home?"';
        
      case 'urgency':
        return 'Find out their timeline. Ask: "Do you need someone out there ASAP or just planning ahead?"';
        
      case 'scheduling':
        if (!this.conversationContext.daySelected) {
          return 'Offer to schedule. Say something like: "I can get you scheduled for a free inspection. What day works best this week?"';
        } else if (!this.conversationContext.timeSelected) {
          return `They chose ${this.conversationContext.daySelected}. Confirm it and ask: "Great! Morning or afternoon work better for you?"`;
        } else if (!this.conversationContext.customerData.name) {
          return 'Get their name for the appointment. Ask: "Perfect! Can I get your first name for the appointment?"';
        } else {
          return 'Confirm the appointment and optionally ask for their email to send confirmation details.';
        }
        
      default:
        return 'Have a natural conversation about their roofing needs. Keep it friendly and helpful.';
    }
  }
  
  updatePhase(response) {
    const lower = response.toLowerCase();
    
    // Update phase based on what we asked
    if (lower.includes("how's your day") || lower.includes("how are you")) {
      this.conversationContext.phase = 'discovery';
    } else if (lower.includes("what's going on") || lower.includes("help you with")) {
      this.conversationContext.phase = 'discovery';
    } else if (lower.includes("your own home") || lower.includes("your property")) {
      this.conversationContext.phase = 'ownership';
    } else if (lower.includes("asap") || lower.includes("planning ahead")) {
      this.conversationContext.phase = 'urgency';
    } else if (lower.includes("what day") || lower.includes("schedule")) {
      this.conversationContext.phase = 'scheduling';
    } else if (lower.includes("morning or afternoon")) {
      // Extract day from conversation
      const dayMatch = this.conversationHistory.slice(-4).join(' ').match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i);
      if (dayMatch) {
        this.conversationContext.daySelected = dayMatch[0];
      }
    } else if (lower.includes("first name") || lower.includes("your name")) {
      // Extract time preference from recent conversation
      const timeMatch = this.conversationHistory.slice(-3).join(' ').match(/\b(morning|afternoon|am|pm)\b/i);
      if (timeMatch) {
        this.conversationContext.timeSelected = timeMatch[0];
      }
    }
  }
  
  getFallbackResponse() {
    switch(this.conversationContext.phase) {
      case 'greeting':
        return "Hey there! This is Mike from Half Price Roof. How's your day going so far?";
      case 'discovery':
        return "What's going on with your roof that I can help with?";
      case 'ownership':
        return "Is this for your own home?";
      case 'urgency':
        return "Do you need someone out there ASAP or just planning ahead?";
      case 'scheduling':
        return "What day works best for you this week?";
      default:
        return "How can I help you with your roofing needs?";
    }
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 Mike: ${content}`);
    
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        content: content,
        content_complete: true,
        actions: [],
        response_id: responseId || Date.now()
      }));
    }
  }
  
  async handleClose() {
    console.log(`🔌 Connection closed for ${this.config?.companyName || this.companyId}`);
    this.connectionActive = false;
    await this.saveConversationData();
  }
  
  async saveConversationData() {
    try {
      const conversationData = {
        companyId: this.companyId,
        companyName: this.config?.companyName,
        callId: this.callId,
        phase: this.conversationContext.phase,
        customerData: this.conversationContext.customerData,
        scheduling: {
          day: this.conversationContext.daySelected,
          time: this.conversationContext.timeSelected
        },
        timestamp: new Date().toISOString()
      };
      
      console.log('💾 Conversation data saved');
      
      // Send to webhook if we have scheduling info
      if (this.conversationContext.daySelected && this.conversationContext.customerData.name) {
        // Get the caller's phone number from the WebSocket connection or call metadata
        const callerPhone = this.req.headers['x-caller-phone'] || 'Phone from call';
        
        await sendSchedulingPreference(
          this.conversationContext.customerData.name,
          this.conversationContext.customerData.email || '',
          callerPhone,
          `${this.conversationContext.daySelected} ${this.conversationContext.timeSelected || ''}`,
          this.callId,
          conversationData
        );
      }
    } catch (error) {
      console.error('Error saving conversation data:', error);
    }
  }
  
  handleError(error) {
    console.error(`❌ WebSocket Error:`, error);
  }
}

module.exports = DynamicWebSocketHandler;
