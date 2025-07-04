// src/services/conversation/SmartConversationManager.js
const ResponseKnowledgeBase = require('./ResponseKnowledgeBase');

class SmartConversationManager {
  constructor(connectionData) {
    this.connectionData = connectionData;
    this.knowledgeBase = new ResponseKnowledgeBase();
    
    // Generate personalized script on initialization
    this.script = this.knowledgeBase.generateConversationScript(connectionData);
    
    // Track conversation state
    this.state = {
      hasGreeted: false,
      hasBuiltRapport: false,
      hasAcknowledgedPainPoint: false,
      hasPresentedSolution: false,
      hasOfferedDemo: false,
      isBooking: false
    };
    
    this.lastUserMessage = null;
  }

  /**
   * Get appropriate response based on conversation state
   */
  async getResponse(userMessage) {
    this.lastUserMessage = userMessage;
    const userLower = userMessage.toLowerCase();
    
    // Handle questions at any point
    if (this.isUserAskingQuestion(userMessage)) {
      const answer = this.handleUserQuestion(userMessage);
      if (answer) return answer;
    }
    
    // Follow conversation flow
    if (!this.state.hasGreeted) {
      this.state.hasGreeted = true;
      return this.script.greeting;
    }
    
    if (!this.state.hasBuiltRapport) {
      this.state.hasBuiltRapport = true;
      const sentiment = this.analyzeSentiment(userMessage);
      return this.script.rapportResponse(sentiment);
    }
    
    if (!this.state.hasAcknowledgedPainPoint) {
      this.state.hasAcknowledgedPainPoint = true;
      // User is acknowledging their pain point
      if (this.isAcknowledgment(userMessage)) {
        return "I hear this from so many " + this.connectionData.business_type + " businesses. So here's the good news...";
      }
      return "Let me tell you how we can help...";
    }
    
    if (!this.state.hasPresentedSolution) {
      this.state.hasPresentedSolution = true;
      return this.script.solution;
    }
    
    if (!this.state.hasOfferedDemo) {
      this.state.hasOfferedDemo = true;
      // Add urgency before demo offer
      return this.script.urgency + " " + this.script.demoOffer;
    }
    
    // Check for scheduling intent
    if (this.isSchedulingIntent(userMessage)) {
      this.state.isBooking = true;
      return "Awesome! Let me check our calendar. What day works best for you this week?";
    }
    
    // Handle objections
    if (this.isObjection(userMessage)) {
      return this.handleObjection(userMessage);
    }
    
    return null;
  }

  /**
   * Check if user is asking a question
   */
  isUserAskingQuestion(message) {
    const questions = [
      'what is', 'what\'s', 'how does', 'how much',
      'cost', 'price', 'how long', 'when can',
      'do you', 'can you', 'will you', '?'
    ];
    
    const lower = message.toLowerCase();
    return questions.some(q => lower.includes(q));
  }

  /**
   * Handle specific user questions
   */
  handleUserQuestion(message) {
    const lower = message.toLowerCase();
    
    // How are you?
    if (lower.includes('how are you') || lower.includes('how about you')) {
      return "I'm doing great, thanks for asking! I'm excited to help you solve your " + 
             this.knowledgeBase.normalizePainPoint(this.connectionData.painPoint).replace(/_/g, ' ') + " challenges.";
    }
    
    // Pricing
    if (lower.includes('cost') || lower.includes('price') || lower.includes('how much')) {
      const industry = this.connectionData.business_type || 'business';
      return `Our pricing is customized based on your ${industry} needs and call volume. Most ${industry} businesses see ROI within 30 days because they're capturing so many more leads. Would you like to see the exact numbers for your situation?`;
    }
    
    // How long to set up?
    if (lower.includes('how long') || lower.includes('setup') || lower.includes('implement')) {
      return "We can have you up and running in 24-48 hours. We handle all the setup, training the AI on your business, and integration with your existing systems. It's completely done-for-you.";
    }
    
    // Does it integrate?
    if (lower.includes('integrate') || lower.includes('crm') || lower.includes('work with')) {
      return "Yes! We integrate with all major CRMs like GoHighLevel, HubSpot, Salesforce, and more. Everything syncs automatically so your workflow stays exactly the same, just automated.";
    }
    
    return null;
  }

  /**
   * Check if user is acknowledging/agreeing
   */
  isAcknowledgment(message) {
    const acknowledgments = [
      'yeah', 'yes', 'yep', 'right', 'exactly',
      'true', 'totally', 'absolutely', 'for sure',
      'i know', 'tell me about it'
    ];
    
    const lower = message.toLowerCase();
    return acknowledgments.some(ack => lower.includes(ack));
  }

  /**
   * Check if user wants to schedule
   */
  isSchedulingIntent(message) {
    const positive = [
      'yes', 'yeah', 'sure', 'ok', 'sounds good',
      'interested', 'let\'s do it', 'book', 'schedule',
      'i\'m in', 'sign me up', 'absolutely'
    ];
    
    const lower = message.toLowerCase();
    return positive.some(word => lower.includes(word));
  }

  /**
   * Check if user has objections
   */
  isObjection(message) {
    const objections = [
      'not sure', 'think about it', 'maybe later',
      'not interested', 'no thanks', 'busy',
      'already have', 'too expensive', 'can\'t afford'
    ];
    
    const lower = message.toLowerCase();
    return objections.some(obj => lower.includes(obj));
  }

  /**
   * Handle common objections
   */
  handleObjection(message) {
    const lower = message.toLowerCase();
    const industry = this.connectionData.business_type || 'business';
    
    if (lower.includes('think about it') || lower.includes('not sure')) {
      return `I completely understand wanting to think it over. Here's what I'll say - the ${industry} businesses that move fastest on this see results fastest. How about we at least show you what's possible? The demo is free and you'll walk away with valuable insights either way.`;
    }
    
    if (lower.includes('too expensive') || lower.includes('afford')) {
      return `I hear you on budget concerns. What's interesting is most ${industry} businesses find this pays for itself within the first month just from the leads they stop missing. Would it help to see the actual ROI numbers for a business like yours?`;
    }
    
    if (lower.includes('already have') || lower.includes('using')) {
      return `That's great that you have something in place! Many of our ${industry} clients switched from other systems because ours actually qualifies leads and books appointments automatically. Would you be open to seeing how it compares?`;
    }
    
    if (lower.includes('busy')) {
      return `I totally get it - that's exactly why this system is so valuable. It handles everything automatically so you can focus on running your ${industry} business. Even a quick 15-minute demo could show you how to save hours every week. What day might work better?`;
    }
    
    return `No problem at all! If you change your mind or want to learn more about solving your ${this.knowledgeBase.normalizePainPoint(this.connectionData.painPoint).replace(/_/g, ' ')} challenges, we're here to help. Is there anything specific I can answer for you?`;
  }

  /**
   * Analyze user sentiment
   */
  analyzeSentiment(message) {
    const lower = message.toLowerCase();
    
    const positive = ['good', 'great', 'awesome', 'excellent', 'well', 'fine'];
    const negative = ['bad', 'terrible', 'not good', 'struggling', 'tough'];
    
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
      recommendedServices: this.script.services,
      readyForScheduling: this.state.hasOfferedDemo && !this.state.isBooking
    };
  }
}

module.exports = SmartConversationManager;
