// src/handlers/WebSocketHandlerWithLearning.js - SIMPLIFIED & FIXED
const WebSocketHandlerWithMemory = require('./WebSocketHandlerWithMemory');
const SelfScoringLearningModule = require('../services/learning/SelfScoringLearningModule');

class WebSocketHandlerWithLearning extends WebSocketHandlerWithMemory {
  constructor(ws, req) {
    super(ws, req);
    
    // Initialize learning components
    this.learningModule = new SelfScoringLearningModule();
    
    // Simplified tracking
    this.conversationMetrics = {
      startTime: Date.now(),
      responses: [],
      userEngagementSignals: 0,
      appointmentBooked: false
    };
    
    // Track voicemail
    this.voicemailCount = 0;
    
    console.log('🧠 Learning-enhanced handler initialized (SIMPLIFIED)');
  }

  /**
   * Check if message is voicemail
   */
  isVoicemailMessage(userMessage) {
    const voicemailPhrases = [
      'at the tone', 'please record your message', 
      'leave a message', 'voicemail', 'is not available'
    ];
    
    const lower = userMessage.toLowerCase();
    return voicemailPhrases.some(phrase => lower.includes(phrase));
  }

  /**
   * Override process user message - SIMPLIFIED
   */
  async processUserMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    
    // Check for voicemail
    if (this.isVoicemailMessage(userMessage)) {
      this.voicemailCount++;
      console.log('📞 Voicemail detected, count:', this.voicemailCount);
      
      if (this.voicemailCount >= 2) {
        await this.sendResponse("I've reached a voicemail. I'll try calling back later.", parsed.response_id);
        // Close connection after brief delay
        setTimeout(() => this.ws.close(), 2000);
        return;
      }
      return; // Don't process voicemail messages
    }
    
    // Reset voicemail count on real interaction
    if (userMessage.length > 5) {
      this.voicemailCount = 0;
    }
    
    // Track engagement
    this.trackUserEngagement(userMessage);
    
    // Use parent class logic with learning enhancements
    await super.processUserMessage(parsed);
  }

  /**
   * Track user engagement - SIMPLIFIED
   */
  trackUserEngagement(userMessage) {
    const lower = userMessage.toLowerCase();
    const positiveSignals = ['yes', 'sure', 'great', 'sounds good', 'interested'];
    
    if (positiveSignals.some(signal => lower.includes(signal))) {
      this.conversationMetrics.userEngagementSignals++;
    }
    
    // Track response for learning
    this.conversationMetrics.responses.push({
      userMessage: userMessage,
      timestamp: Date.now(),
      phase: this.conversationManager?.getState().phase || 'unknown'
    });
  }

  /**
   * Override handle close to score the call
   */
  async handleClose() {
    console.log('🔌 Connection closing - scoring call for learning...');
    
    try {
      // Prepare call data
      const callData = {
        callId: this.callId,
        customerEmail: this.connectionData.customerEmail,
        customerName: this.connectionData.customerName || 
                     `${this.connectionData.firstName || ''} ${this.connectionData.lastName || ''}`.trim(),
        painPoint: this.connectionData.painPoint,
        appointmentBooked: this.appointmentBooked,
        questionsCompleted: this.conversationManager?.getProgress?.()?.questionsCompleted || 0,
        duration: (Date.now() - this.conversationMetrics.startTime) / 1000,
        userEngagementSignals: this.conversationMetrics.userEngagementSignals,
        conversationPhase: this.conversationManager?.getState().phase || 'unknown'
      };
      
      // Score the call
      const scoringResult = await this.learningModule.scoreCall(callData);
      console.log('📊 Call scored:', scoringResult.finalScore, '/100');
      
      // Log key learnings
      if (scoringResult.improvements?.length > 0) {
        console.log('📈 Areas for improvement:', 
          scoringResult.improvements.map(i => i.area).join(', '));
      }
      
    } catch (error) {
      console.error('❌ Error scoring call:', error.message);
    }
    
    // Call parent handleClose
    await super.handleClose();
  }

  /**
   * Send response with learning tracking
   */
  async sendResponse(content, responseId) {
    // Track what we're sending
    this.conversationMetrics.responses.push({
      aiResponse: content,
      timestamp: Date.now(),
      phase: this.conversationManager?.getState().phase || 'unknown'
    });
    
    // Use parent method
    await super.sendResponse(content, responseId);
  }
}

module.exports = WebSocketHandlerWithLearning;
