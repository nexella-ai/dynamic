// src/services/conversation/ConversationFlowManager.js
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
      painPointDiscussed: false,
      solutionPresented: false,
      schedulingOffered: false,
      bookingInProgress: false
    };
    
    // Response control
    this.maxResponseLength = 100; // Keep responses SHORT
    this.responseQueue = [];
    this.isProcessingResponse = false;
  }

  /**
   * Generate QUICK greeting (under 2 seconds to say)
   */
  async generateQuickGreeting() {
    const firstName = this.connectionData.firstName || 'there';
    
    // SUPER SHORT greetings (max 10 words)
    const greetings = [
      `Hi ${firstName}! Sarah from Nexella. How are you?`,
      `Hey ${firstName}! It's Sarah. How's your day?`,
      `Hi ${firstName}! Sarah here. How are things?`
    ];
    
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  /**
   * Generate SHORT rapport response
   */
  generateRapportResponse(userResponse) {
    const responses = {
      positive: [
        "Great to hear! So, about your form submission...",
        "Awesome! I saw what you're struggling with...",
        "Perfect! Let's talk about your challenges..."
      ],
      neutral: [
        "I hear you. About your business challenges...",
        "Got it. So regarding what you submitted...",
        "I understand. About your pain points..."
      ]
    };
    
    const sentiment = this.detectSentiment(userResponse);
    const responseSet = responses[sentiment] || responses.neutral;
    
    return responseSet[Math.floor(Math.random() * responseSet.length)];
  }

  /**
   * Generate CONCISE pain point acknowledgment
   */
  generatePainPointAcknowledgment() {
    const painPoint = this.connectionData.painPoint;
    if (!painPoint) return "Tell me about your biggest challenge right now.";
    
    // SHORT acknowledgments (max 15 words)
    const acknowledgments = {
      "not generating enough leads": "Lead generation is tough. I get it.",
      "not following up with leads quickly enough": "Speed matters with leads. Totally understand.",
      "not speaking to qualified leads": "Wasting time on bad leads is frustrating.",
      "miss calls too much": "Missing calls means missing opportunities.",
      "can't handle the amount of leads": "Too many leads can be overwhelming!",
      "mix of everything above": "Sounds like you need a complete solution."
    };
    
    // Find matching acknowledgment
    for (const [key, response] of Object.entries(acknowledgments)) {
      if (painPoint.toLowerCase().includes(key)) {
        return response;
      }
    }
    
    return "I understand that challenge.";
  }

  /**
   * Generate BRIEF solution presentation
   */
  generateSolutionPresentation() {
    const painPoint = this.connectionData.painPoint?.toLowerCase() || '';
    
    // ULTRA-SHORT solutions (max 25 words)
    if (painPoint.includes('not following up')) {
      return "Our AI responds instantly, 24/7. Never miss another lead. Everything's automated.";
    } else if (painPoint.includes('generating')) {
      return "We capture website visitors, revive old leads, and boost your reputation automatically.";
    } else if (painPoint.includes('miss calls')) {
      return "AI answers every call, day or night. Texts them if they can't talk.";
    } else if (painPoint.includes('qualified')) {
      return "Our AI asks YOUR qualifying questions. Only good leads reach you.";
    } else if (painPoint.includes('handle')) {
      return "Unlimited capacity. Every lead gets instant attention and proper follow-up.";
    } else {
      return "We automate your entire lead process. From first contact to booked appointment.";
    }
  }

  /**
   * Generate demo offer (SHORT)
   */
  generateDemoOffer() {
    const company = this.connectionData.companyName || 'your business';
    return `Want to see this working for ${company}? Free demo with our owner.`;
  }

  /**
   * Detect user sentiment
   */
  detectSentiment(userMessage) {
    const lower = userMessage.toLowerCase();
    
    const positiveWords = ['good', 'great', 'awesome', 'excellent', 'fantastic', 'well'];
    const negativeWords = ['bad', 'terrible', 'awful', 'struggling', 'tough', 'hard'];
    
    if (positiveWords.some(word => lower.includes(word))) {
      return 'positive';
    } else if (negativeWords.some(word => lower.includes(word))) {
      return 'negative';
    }
    
    return 'neutral';
  }

  /**
   * Get next response based on phase
   */
  async getNextResponse(userMessage = '') {
    switch (this.conversationFlow.phase) {
      case 'greeting':
        if (!this.conversationFlow.greetingCompleted) {
          const greeting = await this.generateQuickGreeting();
          this.conversationFlow.greetingCompleted = true;
          this.conversationFlow.phase = 'rapport';
          return greeting;
        }
        break;
        
      case 'rapport':
        if (userMessage && !this.conversationFlow.rapportBuilt) {
          const rapport = this.generateRapportResponse(userMessage);
          this.conversationFlow.rapportBuilt = true;
          this.conversationFlow.phase = 'pain_point';
          return rapport;
        }
        break;
        
      case 'pain_point':
        if (!this.conversationFlow.painPointDiscussed) {
          const acknowledgment = this.generatePainPointAcknowledgment();
          this.conversationFlow.painPointDiscussed = true;
          this.conversationFlow.phase = 'solution';
          return acknowledgment;
        }
        break;
        
      case 'solution':
        if (!this.conversationFlow.solutionPresented) {
          const solution = this.generateSolutionPresentation();
          this.conversationFlow.solutionPresented = true;
          
          // Queue the demo offer for 2 seconds later
          setTimeout(() => {
            this.responseQueue.push(this.generateDemoOffer());
            this.conversationFlow.schedulingOffered = true;
            this.conversationFlow.phase = 'scheduling';
          }, 2000);
          
          return solution;
        }
        break;
        
      case 'scheduling':
        if (this.isSchedulingIntent(userMessage)) {
          this.conversationFlow.phase = 'booking';
          this.conversationFlow.bookingInProgress = true;
          return "Perfect! Let me check the calendar. What day works best?";
        }
        break;
    }
    
    return null;
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
    // Only use AI for complex questions or off-script situations
    const complexIndicators = [
      'how', 'what', 'why', 'when', 'where', 'explain',
      'tell me more', 'cost', 'price', 'how much'
    ];
    
    const lower = userMessage.toLowerCase();
    return complexIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Truncate response to keep it SHORT
   */
  truncateResponse(response, maxWords = 25) {
    const words = response.split(' ');
    if (words.length <= maxWords) return response;
    
    // Find a good breaking point
    const truncated = words.slice(0, maxWords).join(' ');
    
    // Add a natural ending
    if (!truncated.match(/[.!?]$/)) {
      return truncated + '...';
    }
    
    return truncated;
  }

  /**
   * Get conversation state
   */
  getState() {
    return {
      phase: this.conversationFlow.phase,
      readyForScheduling: this.conversationFlow.schedulingOffered && !this.conversationFlow.bookingInProgress,
      bookingInProgress: this.conversationFlow.bookingInProgress,
      completed: this.conversationFlow.phase === 'completed'
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
  }

  /**
   * Generate AI response with LENGTH LIMIT
   */
  async generateAIResponse(messages, maxTokens = 50) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            ...messages,
            {
              role: 'system',
              content: 'Keep your response under 25 words. Be direct and conversational.'
            }
          ],
          temperature: 0.7,
          max_tokens: maxTokens
        },
        {
          headers: {
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000 // 5 second timeout
        }
      );
      
      return this.truncateResponse(response.data.choices[0].message.content);
    } catch (error) {
      console.error('AI response error:', error.message);
      return "I understand. Let me help you with that.";
    }
  }
}

module.exports = ConversationFlowManager;
