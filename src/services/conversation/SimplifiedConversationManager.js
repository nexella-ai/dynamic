// src/services/conversation/SimplifiedConversationManager.js
const axios = require('axios');
const config = require('../../config/environment');

class SimplifiedConversationManager {
  constructor(connectionData) {
    this.connectionData = connectionData;
    
    // Simple state tracking
    this.state = {
      hasGreeted: false,
      hasBuiltRapport: false,
      hasAcknowledgedPainPoint: false,
      hasPresentedSolution: false,
      hasOfferedDemo: false,
      isBooking: false
    };
    
    // Track what we're waiting for
    this.waitingFor = null;
    this.lastBotMessage = null;
  }

  /**
   * Get appropriate response based on user message and current state
   */
  async getResponse(userMessage) {
    const userLower = userMessage.toLowerCase();
    
    // ALWAYS respond to direct questions first
    if (this.isUserAskingQuestion(userMessage)) {
      return this.handleUserQuestion(userMessage);
    }
    
    // Then follow conversation flow
    if (!this.state.hasGreeted) {
      return this.generateGreeting();
    }
    
    if (!this.state.hasBuiltRapport) {
      return this.buildRapport(userMessage);
    }
    
    if (!this.state.hasAcknowledgedPainPoint) {
      return this.acknowledgePainPoint(userMessage);
    }
    
    if (!this.state.hasPresentedSolution) {
      return this.presentSolution(userMessage);
    }
    
    if (!this.state.hasOfferedDemo) {
      return this.offerDemo();
    }
    
    // Check for scheduling intent
    if (this.isSchedulingIntent(userMessage)) {
      this.state.isBooking = true;
      return "Awesome! Let me check our calendar. What day works best for you this week?";
    }
    
    return null;
  }

  /**
   * Check if user is asking a question
   */
  isUserAskingQuestion(userMessage) {
    const questions = [
      'how are you', 'how\'s it going', 'how about you',
      'what about you', 'and you?', 'you?',
      'what is', 'what\'s', 'how does', 'how do',
      'can you', 'will you', 'do you'
    ];
    
    const lower = userMessage.toLowerCase();
    return questions.some(q => lower.includes(q)) || userMessage.includes('?');
  }

  /**
   * Handle user questions appropriately
   */
  handleUserQuestion(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // How are you?
    if (lower.includes('how are you') || lower.includes('how about you')) {
      this.waitingFor = null; // Clear any waiting state
      return "I'm doing great, thanks for asking! I'm excited to help you solve your lead follow-up challenges.";
    }
    
    // What is Nexella?
    if (lower.includes('what is nexella') || lower.includes('what do you do')) {
      return "Nexella AI helps businesses like yours never miss another lead. We use AI to instantly respond to every inquiry, qualify leads, and book appointments automatically - 24/7.";
    }
    
    // How does it work?
    if (lower.includes('how does') || lower.includes('how do')) {
      return "Great question! Our AI handles all your customer interactions - phone calls, texts, and web chats. It responds instantly, asks your qualifying questions, and books appointments directly into your calendar. Everything happens automatically while you focus on closing deals.";
    }
    
    // Pricing
    if (lower.includes('cost') || lower.includes('price') || lower.includes('how much')) {
      return "Our pricing is customized based on your specific needs and call volume. The best part is, most clients see ROI within 30 days. Would you like to see exactly how it would work for your business?";
    }
    
    return null;
  }

  /**
   * Generate initial greeting
   */
  generateGreeting() {
    this.state.hasGreeted = true;
    this.waitingFor = 'how_are_you_response';
    const firstName = this.connectionData.firstName || 'there';
    return `Hi ${firstName}! This is Sarah from Nexella AI. How are you doing today?`;
  }

  /**
   * Build rapport based on their response
   */
  buildRapport(userMessage) {
    const sentiment = this.analyzeSentiment(userMessage);
    const company = this.connectionData.companyName || 'your company';
    
    let response = '';
    
    // First, acknowledge their response
    if (sentiment === 'positive') {
      response = "That's wonderful to hear! ";
    } else if (sentiment === 'negative') {
      response = "I'm sorry to hear that. I hope things improve for you. ";
    } else {
      response = "Thanks for letting me know. ";
    }
    
    // If they asked how we are, we already responded, so move to pain point
    if (this.waitingFor !== 'how_are_you_response') {
      this.state.hasBuiltRapport = true;
      this.state.hasAcknowledgedPainPoint = true;
      
      // Acknowledge their pain point
      const painPoint = this.connectionData.painPoint;
      if (painPoint && painPoint.toLowerCase().includes('following up')) {
        response += `So I was looking at your form, and I see that you're struggling with following up with leads quickly enough at ${company}. Time is everything in real estate, isn't it? You know those first few minutes are critical...`;
      }
    } else {
      // They just answered how they are, so acknowledge and move to pain point
      this.state.hasBuiltRapport = true;
      response += `So I was just reviewing what you submitted...`;
    }
    
    this.waitingFor = 'pain_point_acknowledgment';
    return response;
  }

  /**
   * Acknowledge their pain point
   */
  acknowledgePainPoint(userMessage) {
    this.state.hasAcknowledgedPainPoint = true;
    this.waitingFor = 'ready_for_solution';
    
    // Check if they're acknowledging/agreeing
    const lower = userMessage.toLowerCase();
    if (lower.includes('yeah') || lower.includes('yes') || lower.includes('exactly') || lower.includes('right')) {
      return "I hear this all the time from real estate professionals. You get a lead but by the time you follow up, they've already moved on to someone else. So here's the good news...";
    }
    
    return "I completely understand. Let me tell you how we can help...";
  }

  /**
   * Present the solution
   */
  presentSolution(userMessage) {
    this.state.hasPresentedSolution = true;
    this.waitingFor = 'solution_response';
    
    const painPoint = this.connectionData.painPoint?.toLowerCase() || '';
    
    if (painPoint.includes('following up')) {
      return "Our AI responds to every lead within 5 seconds, 24/7. It answers their questions about properties, qualifies them based on YOUR criteria - things like budget, timeline, pre-approval status - and books appointments directly into your calendar. While your competition is still checking their voicemail, you've already secured the appointment!";
    }
    
    return "Our AI system handles all your lead interactions instantly, qualifies them based on your criteria, and books appointments automatically. You never miss another opportunity.";
  }

  /**
   * Offer demo
   */
  offerDemo() {
    this.state.hasOfferedDemo = true;
    this.waitingFor = 'demo_response';
    
    const firstName = this.connectionData.firstName || '';
    const company = this.connectionData.companyName || 'your company';
    
    // Add a small delay before offering
    return `You know what${firstName ? ', ' + firstName : ''}? I'd love to show you exactly how this would work for ${company}. Our founder Jaden does these personalized demo calls where he can show you the system live and create a custom solution just for you. It's completely free and super valuable. Would you be interested in seeing it in action?`;
  }

  /**
   * Check if user wants to schedule
   */
  isSchedulingIntent(userMessage) {
    const lower = userMessage.toLowerCase();
    const positiveIndicators = [
      'yes', 'yeah', 'sure', 'ok', 'sounds good',
      'interested', 'let\'s do it', 'book', 'schedule'
    ];
    
    return positiveIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Analyze sentiment
   */
  analyzeSentiment(message) {
    const lower = message.toLowerCase();
    
    const positive = ['good', 'great', 'awesome', 'well', 'fine'];
    const negative = ['bad', 'not good', 'terrible', 'struggling'];
    
    if (positive.some(word => lower.includes(word))) return 'positive';
    if (negative.some(word => lower.includes(word))) return 'negative';
    
    return 'neutral';
  }

  /**
   * Get current state
   */
  getState() {
    return {
      ...this.state,
      waitingFor: this.waitingFor,
      readyForScheduling: this.state.hasOfferedDemo && !this.state.isBooking
    };
  }

  /**
   * Force state transition (for debugging)
   */
  setState(updates) {
    Object.assign(this.state, updates);
  }
}

module.exports = SimplifiedConversationManager;
