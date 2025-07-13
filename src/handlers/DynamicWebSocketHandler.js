// src/handlers/DynamicWebSocketHandler.js - SIMPLIFIED & RELIABLE VERSION
const axios = require('axios');
const configLoader = require('../services/config/ConfigurationLoader');
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
    
    // Simple state tracking
    this.state = {
      step: 0,
      name: null,
      email: null,
      need: null,
      isOwner: null,
      urgency: null,
      day: null,
      time: null
    };
    
    // Conversation history for context
    this.messages = [];
    
    this.initialize();
  }
  
  async initialize() {
    try {
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      console.log(`🏢 Initialized handler for ${this.config.companyName}`);
      console.log(`🤖 AI Agent: ${this.config.aiAgent.name}`);
      console.log(`📞 Call ID: ${this.callId}`);
      
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('close', () => this.handleClose());
      this.ws.on('error', (err) => console.error('❌ Error:', err));
      
    } catch (error) {
      console.error('❌ Failed to initialize:', error);
      this.ws.close(1011, 'Configuration error');
    }
  }
  
  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      if (parsed.interaction_type === 'response_required') {
        const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
        console.log(`🗣️ User: ${userMessage}`);
        
        // Small delay for natural feel
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Get response based on current step
        const response = await this.getNextResponse(userMessage);
        
        if (response) {
          console.log(`🤖 Mike: ${response}`);
          await this.sendResponse(response, parsed.response_id);
        }
      }
    } catch (error) {
      console.error('❌ Message error:', error);
    }
  }
  
  async getNextResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    this.messages.push(userMessage);
    
    // Step-by-step conversation flow
    switch(this.state.step) {
      case 0: // Initial greeting
        this.state.step = 1;
        return "Hey there! This is Mike from Half Price Roof. How's your day going so far?";
        
      case 1: // Build rapport
        this.state.step = 2;
        if (lower.includes('good') || lower.includes('fine') || lower.includes('well')) {
          return "Glad to hear it! So what's going on with your roof?";
        } else if (lower.includes('bad') || lower.includes('not')) {
          return "Oh sorry to hear that. Well hopefully I can help - what's happening with your roof?";
        } else {
          return "I appreciate you taking my call! What can I help you with regarding your roof?";
        }
        
      case 2: // Understand need
        if (lower.includes('replac')) {
          this.state.need = 'replacement';
          this.state.step = 3;
          return "Got it, you need a full roof replacement. Is this for your own home?";
        } else if (lower.includes('leak') || lower.includes('repair')) {
          this.state.need = 'repair';
          this.state.step = 3;
          return "Oh no, dealing with a leak? Let me help. Is this your own property?";
        } else if (lower.includes('inspection')) {
          this.state.need = 'inspection';
          this.state.step = 3;
          return "Smart to get it checked out! Is this for your own home?";
        } else {
          return "Are you looking for a repair, replacement, or just want a free inspection?";
        }
        
      case 3: // Check ownership
        if (lower.includes('yes') || lower.includes('yeah') || lower.includes('yep')) {
          this.state.isOwner = true;
          this.state.step = 4;
          return "Perfect. Do you need someone out there ASAP or are you just planning ahead?";
        } else if (lower.includes('no')) {
          this.state.isOwner = false;
          this.state.step = 4;
          return "No problem! Are you authorized to schedule this work?";
        } else {
          return "Just to clarify - is this your property?";
        }
        
      case 4: // Check urgency
        if (lower.includes('asap') || lower.includes('urgent') || lower.includes('soon')) {
          this.state.urgency = 'urgent';
          this.state.step = 5;
          return "I understand it's urgent! Good news - I can get someone out as early as tomorrow. What day works best?";
        } else {
          this.state.urgency = 'planning';
          this.state.step = 5;
          return "Great, planning ahead is smart. What day this week works best for a free inspection?";
        }
        
      case 5: // Get day
        const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/);
        if (dayMatch) {
          this.state.day = dayMatch[0];
          this.state.step = 6;
          return `${this.capitalize(this.state.day)} works great! Do you prefer morning or afternoon?`;
        } else {
          return "What day works best - I have openings all week.";
        }
        
      case 6: // Get time
        if (lower.includes('morning') || lower.includes('am')) {
          this.state.time = 'morning';
          this.state.step = 7;
          return "Perfect! I've got you down for " + this.state.day + " morning. Can I get your first name?";
        } else if (lower.includes('afternoon') || lower.includes('pm')) {
          this.state.time = 'afternoon';
          this.state.step = 7;
          return "Perfect! I've got you down for " + this.state.day + " afternoon. Can I get your first name?";
        } else {
          return "Morning or afternoon - what's better?";
        }
        
      case 7: // Get name
        this.state.name = userMessage.trim();
        this.state.step = 8;
        return `Awesome ${this.state.name}! You're all set for ${this.state.day} ${this.state.time}. We'll call 30 minutes before arrival. Would you like me to send a confirmation email?`;
        
      case 8: // Optional email
        if (lower.includes('yes') || lower.includes('sure')) {
          this.state.step = 9;
          return "Great! What's your email address?";
        } else if (lower.includes('no')) {
          this.state.step = 10;
          return "No problem! You're all confirmed. We'll see you " + this.state.day + ". Anything else I can help with?";
        } else {
          // They might have given email directly
          const emailMatch = userMessage.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
          if (emailMatch) {
            this.state.email = emailMatch[0];
            this.state.step = 10;
            return "Got it! I'll send the confirmation to " + this.state.email + ". We'll see you " + this.state.day + "!";
          } else {
            return "Would you like an email confirmation?";
          }
        }
        
      case 9: // Capture email
        const emailMatch2 = userMessage.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
        if (emailMatch2) {
          this.state.email = emailMatch2[0];
          this.state.step = 10;
          return "Perfect! I'll send the confirmation to " + this.state.email + ". We'll see you " + this.state.day + "!";
        } else {
          return "Could you repeat your email address?";
        }
        
      case 10: // End
        return "Thanks for choosing Half Price Roof! Have a great day!";
        
      default:
        return "Is there anything else I can help you with?";
    }
  }
  
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  async sendResponse(content, responseId) {
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
    console.log('🔌 Connection closed');
    
    // Save data if we got far enough
    if (this.state.name && this.state.day) {
      const data = {
        companyId: this.companyId,
        callId: this.callId,
        customer: this.state,
        scheduledFor: `${this.state.day} ${this.state.time || ''}`,
        timestamp: new Date().toISOString()
      };
      
      console.log('💾 Saving appointment:', data);
      
      // Get phone from call metadata
      const callerPhone = this.req.headers['x-caller-phone'] || 'From call';
      
      await sendSchedulingPreference(
        this.state.name,
        this.state.email || '',
        callerPhone,
        `${this.state.day} ${this.state.time || ''}`,
        this.callId,
        data
      );
    }
  }
}

module.exports = DynamicWebSocketHandler;
