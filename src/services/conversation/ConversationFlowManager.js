// src/services/conversation/ConversationFlowManager.js - FIXED VERSION
const axios = require('axios');
const config = require('../../config/environment');

class ConversationFlowManager {
  constructor(connectionData, memoryService = null) {
    this.connectionData = connectionData;
    this.memoryService = memoryService;
    
    // Conversation flow state
    this.conversationFlow = {
      phase: 'greeting',
      greetingCompleted: false,
      rapportBuilt: false,
      painPointMentioned: false,
      painPointAcknowledged: false,
      solutionPresented: false,
      schedulingOffered: false,
      bookingInProgress: false
    };
    
    // Context storage
    this.industryContext = null;
    this.painPointContext = null;
    this.solutionContext = null;
    
    // CRITICAL FIX: Remove response queue to prevent multiple responses
    // Responses should be handled synchronously by the WebSocketHandler
    this.pendingResponses = [];
    this.lastResponseTime = 0;
  }

  /**
   * Initialize context from RAG memory
   */
  async initializeContext() {
    if (!this.memoryService) return;
    
    try {
      // Get industry-specific context
      const industryQuery = `${this.connectionData.business_type || this.connectionData.companyName} industry challenges pain points`;
      this.industryContext = await this.getRAGContext(industryQuery);
      
      // Get pain point specific context
      if (this.connectionData.painPoint) {
        const painPointQuery = `${this.connectionData.business_type} ${this.connectionData.painPoint} solutions`;
        this.painPointContext = await this.getRAGContext(painPointQuery);
      }
      
      console.log('✅ Initialized RAG context for', this.connectionData.business_type);
    } catch (error) {
      console.error('❌ Error initializing context:', error.message);
    }
  }

  /**
   * Get context from RAG memory
   */
  async getRAGContext(query) {
    if (!this.memoryService) return null;
    
    try {
      // Check if we have a valid customer email before searching
      const customerEmail = this.connectionData.customerEmail;
      
      // Only search for customer-specific memories if we have a valid email
      let results = [];
      let nexellaContext = null;
      
      if (customerEmail && customerEmail !== 'prospect@example.com' && customerEmail !== '') {
        // Search for relevant memories
        results = await this.memoryService.retrieveRelevantMemories(
          customerEmail,
          query,
          3
        );
        
        // Also search Nexella knowledge base
        nexellaContext = await this.memoryService.generateEnhancedConversationContext(
          customerEmail,
          query
        );
      } else {
        // If no customer email, just search general Nexella knowledge
        console.log('🔍 No customer email, searching general knowledge only');
        nexellaContext = await this.memoryService.generateEnhancedConversationContext(
          null,
          query
        );
      }
      
      return {
        memories: results,
        nexellaContext: nexellaContext
      };
    } catch (error) {
      console.error('❌ Error getting RAG context:', error.message);
      return null;
    }
  }

  /**
   * Generate personalized greeting
   */
  async generateQuickGreeting() {
    const firstName = this.connectionData.firstName || 'there';
    return `Hi ${firstName}! This is Sarah from Nexella AI. How are you doing today?`;
  }

  /**
   * Generate industry-aware rapport response
   */
  async generateRapportResponse(userResponse) {
    const sentiment = this.detectSentiment(userResponse);
    const firstName = this.connectionData.firstName || '';
    
    // Base response based on sentiment
    let baseResponse = '';
    if (sentiment === 'positive') {
      baseResponse = `That's great to hear! I'm doing well too, thank you for asking.`;
    } else if (sentiment === 'negative') {
      baseResponse = `I'm sorry to hear that. I hope things get better. I'm doing okay, thanks.`;
    } else {
      baseResponse = `I hear you. I'm doing alright, thanks for asking.`;
    }
    
    // Add transition to pain point
    const transition = ` So I was looking at your form about ${this.connectionData.companyName || 'your business'}... it sounds like you're dealing with some real challenges. `;
    
    // Mention specific pain point
    let painPointMention = '';
    if (this.connectionData.painPoint) {
      const painLower = this.connectionData.painPoint.toLowerCase();
      if (painLower.includes('miss calls')) {
        painPointMention = `I see that you're missing too many calls. That must be really frustrating when you know each one could be a potential customer...`;
      } else if (painLower.includes('generating') && painLower.includes('leads')) {
        painPointMention = `I noticed you're struggling to generate enough leads. That's tough, especially with how competitive things are...`;
      } else if (painLower.includes('following up')) {
        painPointMention = `You mentioned having trouble following up quickly with leads. I totally understand - time is everything in sales...`;
      } else if (painLower.includes('qualified')) {
        painPointMention = `I see you're dealing with unqualified leads. That's so frustrating when you're wasting time on people who aren't a good fit...`;
      } else if (painLower.includes('handle') && painLower.includes('amount')) {
        painPointMention = `You mentioned being overwhelmed with the volume of leads. What a great problem to have, but I know it's still stressful...`;
      } else {
        painPointMention = `I see from your form that you're struggling with "${this.connectionData.painPoint}". That sounds really challenging...`;
      }
    }
    
    return `${baseResponse}${transition}${painPointMention}`;
  }

  /**
   * Generate solution presentation
   */
  async generateSolutionPresentation() {
    const painPoint = this.connectionData.painPoint?.toLowerCase() || '';
    const firstName = this.connectionData.firstName || '';
    const company = this.connectionData.companyName || 'your company';
    
    // Map pain points to solutions
    const solutionMap = {
      'miss calls': `Here's exactly how we solve this... Our AI answers every single call, 24/7, and sounds just like a real person. We follow up with every lead instantly by text, so they never go cold. Everything integrates with your current systems seamlessly.`,
      'generating': `For companies struggling with lead generation, we provide three powerful solutions: AI Texting captures website visitors instantly, SMS Revive reactivates your old database, and our Review Collector boosts your online reputation to attract more leads organically.`,
      'following up': `Our AI responds to every lead within seconds, 24/7. It answers questions, nurtures leads automatically, and books appointments without any manual work. You'll never lose another lead to slow follow-up.`,
      'qualified': `We pre-qualify every lead based on YOUR exact criteria before they ever reach you. Our AI asks the right questions and only books appointments with serious, qualified prospects.`,
      'handle': `Our complete automation suite handles unlimited leads simultaneously. Every lead gets instant attention, proper qualification, and automatic scheduling. Your CRM stays updated automatically so nothing falls through the cracks.`
    };
    
    // Find matching solution
    for (const [key, solution] of Object.entries(solutionMap)) {
      if (painPoint.includes(key)) {
        return solution;
      }
    }
    
    // Default solution
    return `So here's how we help... Our AI handles all your customer interactions 24/7, qualifies leads based on YOUR criteria, and books appointments automatically. You focus on serving clients, we handle the rest.`;
  }

  /**
   * Generate demo offer
   */
  generateDemoOffer() {
    const firstName = this.connectionData.firstName || '';
    const company = this.connectionData.companyName || 'your company';
    
    return `You know what? I'd love to show you exactly how this would work for ${company}. Our owner, Jaden, does these personalized demo calls where he can show you the system live and create a custom solution just for you. It's completely free and super valuable. Would you be interested in seeing it in action?`;
  }

  /**
   * Get next response based on phase - CRITICAL FIX: Return single response only
   */
  async getNextResponse(userMessage = '') {
    // Initialize context on first response
    if (!this.industryContext && this.conversationFlow.phase === 'greeting') {
      await this.initializeContext();
    }
    
    // CRITICAL: Only return one response at a time
    let response = null;
    
    switch (this.conversationFlow.phase) {
      case 'greeting':
        if (!this.conversationFlow.greetingCompleted) {
          response = await this.generateQuickGreeting();
          this.conversationFlow.greetingCompleted = true;
          this.conversationFlow.phase = 'rapport';
        }
        break;
        
      case 'rapport':
        if (userMessage && !this.conversationFlow.rapportBuilt) {
          response = await this.generateRapportResponse(userMessage);
          this.conversationFlow.rapportBuilt = true;
          this.conversationFlow.painPointMentioned = true;
          this.conversationFlow.phase = 'pain_point_acknowledge';
        }
        break;
        
      case 'pain_point_acknowledge':
        if (userMessage && !this.conversationFlow.painPointAcknowledged) {
          // Check if user acknowledged the pain point
          const acknowledgments = ['yeah', 'yes', 'yep', 'right', 'exactly', 'true', 'definitely'];
          const userLower = userMessage.toLowerCase();
          const isAcknowledgment = acknowledgments.some(ack => userLower.includes(ack));
          
          if (isAcknowledgment) {
            this.conversationFlow.painPointAcknowledged = true;
            this.conversationFlow.phase = 'solution';
            // Store transition phrase for next call
            this.pendingResponses.push({
              type: 'transition',
              content: "So here's the good news..."
            });
            response = "So here's the good news...";
          } else {
            response = "I completely understand. It's a real challenge that many businesses face.";
          }
        }
        break;
        
      case 'solution':
        if (!this.conversationFlow.solutionPresented) {
          response = await this.generateSolutionPresentation();
          this.conversationFlow.solutionPresented = true;
          // Store demo offer for next interaction
          this.pendingResponses.push({
            type: 'demo_offer',
            delay: 3000
          });
        } else if (this.pendingResponses.length > 0 && this.pendingResponses[0].type === 'demo_offer') {
          this.pendingResponses.shift();
          response = this.generateDemoOffer();
          this.conversationFlow.schedulingOffered = true;
          this.conversationFlow.phase = 'scheduling';
        }
        break;
        
      case 'scheduling':
        // Scheduling is handled by the main handler
        response = null;
        break;
    }
    
    return response;
  }

  /**
   * Check if we should send next queued response
   */
  shouldSendQueuedResponse() {
    if (this.pendingResponses.length === 0) return false;
    
    const nextResponse = this.pendingResponses[0];
    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTime;
    
    // Check if enough time has passed
    const requiredDelay = nextResponse.delay || 2000;
    return timeSinceLastResponse >= requiredDelay;
  }

  /**
   * Get queued response if ready
   */
  getQueuedResponse() {
    if (this.shouldSendQueuedResponse()) {
      const response = this.pendingResponses.shift();
      this.lastResponseTime = Date.now();
      
      if (response.type === 'demo_offer') {
        return this.generateDemoOffer();
      } else if (response.content) {
        return response.content;
      }
    }
    return null;
  }

  /**
   * Generate AI response with context
   */
  async generateAIResponse(messages, maxTokens = 50) {
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
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      console.error('AI response error:', error.message);
      return null;
    }
  }

  /**
   * Detect user sentiment
   */
  detectSentiment(userMessage) {
    const lower = userMessage.toLowerCase();
    
    const positiveWords = ['good', 'great', 'awesome', 'excellent', 'fantastic', 'well', 'fine', 'alright', 'okay'];
    const negativeWords = ['bad', 'terrible', 'awful', 'struggling', 'tough', 'hard', 'stressed', 'rough'];
    
    if (positiveWords.some(word => lower.includes(word))) {
      return 'positive';
    } else if (negativeWords.some(word => lower.includes(word))) {
      return 'negative';
    }
    
    return 'neutral';
  }

  /**
   * Check if user wants to schedule
   */
  isSchedulingIntent(userMessage) {
    const lower = userMessage.toLowerCase();
    const positiveIndicators = [
      'yes', 'yeah', 'sure', 'ok', 'sounds good', 'interested',
      'let\'s do it', 'book', 'schedule', 'demo', 'show me'
    ];
    
    return positiveIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Check if we need AI response
   */
  needsAIResponse(userMessage) {
    const complexIndicators = [
      'how', 'what', 'why', 'when', 'where', 'explain',
      'tell me more', 'cost', 'price', 'how much', 'work'
    ];
    
    const lower = userMessage.toLowerCase();
    return complexIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Get conversation state
   */
  getState() {
    return {
      phase: this.conversationFlow.phase,
      readyForScheduling: this.conversationFlow.schedulingOffered && !this.conversationFlow.bookingInProgress,
      bookingInProgress: this.conversationFlow.bookingInProgress,
      completed: this.conversationFlow.phase === 'completed',
      hasPendingResponse: this.pendingResponses.length > 0
    };
  }

  /**
   * Force transition to phase
   */
  transitionTo(phase) {
    console.log(`🔄 Transitioning from ${this.conversationFlow.phase} to ${phase}`);
    this.conversationFlow.phase = phase;
    
    if (phase === 'booking') {
      this.conversationFlow.bookingInProgress = true;
    } else if (phase === 'completed') {
      this.conversationFlow.bookingInProgress = false;
    }
  }

  /**
   * Mark booking as completed
   */
  markBookingComplete() {
    this.conversationFlow.phase = 'completed';
    this.conversationFlow.bookingInProgress = false;
    // Clear any pending responses
    this.pendingResponses = [];
  }

  /**
   * Update last response time
   */
  updateResponseTime() {
    this.lastResponseTime = Date.now();
  }
}

module.exports = ConversationFlowManager;
