// src/handlers/WebSocketHandlerWithLearning.js - FIXED VERSION
const WebSocketHandlerWithMemory = require('./WebSocketHandlerWithMemory');
const SelfScoringLearningModule = require('../services/learning/SelfScoringLearningModule');
const AdaptiveResponseGenerator = require('../services/learning/AdaptiveResponseGenerator');

class WebSocketHandlerWithLearning extends WebSocketHandlerWithMemory {
  constructor(ws, req) {
    super(ws, req);
    
    // Initialize learning components
    this.learningModule = new SelfScoringLearningModule();
    this.adaptiveGenerator = new AdaptiveResponseGenerator(this.memoryService);
    
    // Enhanced tracking for learning
    this.conversationMetrics = {
      startTime: Date.now(),
      responses: [],
      userEngagementSignals: 0,
      disengagementSignals: 0,
      smoothTransitions: 0,
      abruptTransitions: 0,
      missedCues: 0,
      repeatedQuestions: 0,
      averageResponseTime: 0,
      responseTimeSum: 0,
      responseCount: 0,
      userMessageLengths: [],
      bookingAttempted: false,
      objections: [],
      positiveSignals: ['sounds good', 'great', 'yes', 'sure', 'interested', 'tell me more'],
      negativeSignals: ['not interested', 'no', 'busy', 'later', 'goodbye', 'stop']
    };
    
    // Track if user has spoken
    this.userHasSpoken = false;
    this.greetingSent = false;
    
    console.log('🧠 Self-Learning WebSocket Handler initialized');
  }

  /**
   * Override initialization to set proper phase based on Typeform data
   */
  async initialize() {
    await super.initialize();
    
    // CRITICAL FIX: If we have Typeform data with pain point, skip discovery
    if (this.connectionData.painPoint && this.connectionData.firstName) {
      console.log('📋 Have Typeform data - adjusting conversation flow');
      
      // Set conversation manager to skip discovery
      if (this.conversationManager) {
        this.conversationManager.conversationFlow.phase = 'greeting';
        this.conversationManager.conversationFlow.greetingCompleted = false;
        this.conversationManager.conversationFlow.painPointKnown = true;
        
        // Pre-populate pain point context
        this.conversationManager.painPointContext = this.connectionData.painPoint;
      }
    }
  }

  /**
   * Override processUserMessage to use adaptive responses
   */
  async processUserMessage(parsed) {
    // Prevent duplicate processing
    const messageId = parsed.response_id || Date.now();
    if (this.lastProcessedMessageId === messageId) {
      return;
    }
    this.lastProcessedMessageId = messageId;
    
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    
    console.log('🗣️ User said:', userMessage);
    
    // Mark that user has spoken
    if (!this.userHasSpoken && userMessage.trim()) {
      this.userHasSpoken = true;
      console.log('✅ User has spoken - starting conversation');
    }
    
    // Track metrics
    this.trackUserEngagement(userMessage);
    
    // Build current conversation state
    const conversationState = this.buildConversationState(userMessage);
    
    console.log('📊 Current conversation state:', {
      phase: conversationState.phase,
      hasPainPoint: !!conversationState.customerProfile.painPoint,
      questionsCompleted: conversationState.questionsCompleted
    });
    
    // CRITICAL FIX: Don't get stuck in loops
    if (this.responseInProgress) {
      console.log('🚫 Response already in progress, skipping');
      return;
    }
    
    // Get suggested action from learning module
    const suggestedAction = await this.learningModule.suggestNextBestAction(conversationState);
    
    console.log('🎯 Learning suggestion:', suggestedAction);
    
    // CRITICAL FIX: Progress conversation based on Typeform data
    let response = null;
    
    if (!this.greetingSent && this.userHasSpoken) {
      // Send personalized greeting
      response = await this.generateGreeting();
      this.greetingSent = true;
      this.conversationManager.conversationFlow.phase = 'rapport';
    } else if (conversationState.phase === 'rapport' && !conversationState.rapportBuilt) {
      // Build rapport and acknowledge pain point
      response = await this.generateRapportResponse(userMessage);
      this.conversationManager.conversationFlow.rapportBuilt = true;
      this.conversationManager.conversationFlow.phase = 'solution';
    } else if (conversationState.phase === 'solution' && !conversationState.solutionPresented) {
      // Present solution
      response = await this.generateSolutionResponse();
      this.conversationManager.conversationFlow.solutionPresented = true;
      
      // Queue scheduling offer
      setTimeout(async () => {
        if (!this.responseInProgress && !this.appointmentBooked) {
          const schedulingOffer = await this.generateSchedulingOffer();
          await this.sendSingleResponse(schedulingOffer, Date.now());
          this.conversationManager.conversationFlow.phase = 'scheduling';
          this.conversationManager.conversationFlow.schedulingOffered = true;
        }
      }, 3000);
    } else if (conversationState.phase === 'scheduling') {
      // Handle scheduling
      await this.handleBookingPhase(userMessage, parsed.response_id);
      return;
    } else if (suggestedAction.confidence > 0.7) {
      // Apply suggested action
      await this.applySuggestedAction(suggestedAction, parsed.response_id);
      return;
    } else {
      // Use adaptive response generation
      response = await this.adaptiveGenerator.generateAdaptiveResponse(
        conversationState,
        userMessage
      );
    }
    
    // Track response metrics
    if (response) {
      this.trackResponseMetrics(response);
      await this.sendSingleResponse(response, parsed.response_id);
    }
  }

  /**
   * Generate personalized greeting using Typeform data
   */
  async generateGreeting() {
    const firstName = this.connectionData.firstName || 'there';
    const company = this.connectionData.companyName;
    
    return `Hi ${firstName}! This is Sarah from Nexella AI. How are you doing today?`;
  }

  /**
   * Generate rapport response that acknowledges pain point
   */
  async generateRapportResponse(userMessage) {
    const sentiment = this.analyzeSentiment(userMessage);
    const firstName = this.connectionData.firstName || '';
    const painPoint = this.connectionData.painPoint;
    
    let response = '';
    
    // Acknowledge their response
    if (sentiment === 'positive') {
      response = "That's great to hear! ";
    } else if (sentiment === 'negative') {
      response = "I'm sorry to hear that. ";
    } else {
      response = "Thanks for letting me know. ";
    }
    
    // Acknowledge pain point from Typeform
    if (painPoint) {
      const painLower = painPoint.toLowerCase();
      
      if (painLower.includes('following up') && painLower.includes('quickly')) {
        response += `So I saw from your form that you're struggling with following up with leads quickly enough at ${this.connectionData.companyName}. That's such a common challenge in real estate - time is everything when you're competing for listings, right?`;
      } else if (painLower.includes('miss calls')) {
        response += `I noticed from your form that you're missing too many calls. That must be really frustrating when each call could be your next big listing...`;
      } else if (painLower.includes('generating') && painLower.includes('leads')) {
        response += `I see from your form that generating enough leads is a challenge. That's tough, especially with how competitive the real estate market is...`;
      } else {
        response += `I saw from your form that you're dealing with "${painPoint}". That sounds really challenging...`;
      }
      
      this.conversationManager.conversationFlow.painPointAcknowledged = true;
    }
    
    return response;
  }

  /**
   * Generate solution response based on pain point
   */
  async generateSolutionResponse() {
    const painPoint = this.connectionData.painPoint?.toLowerCase() || '';
    const businessType = this.connectionData.business_type || '';
    
    let solution = "Here's exactly how we can help... ";
    
    if (painPoint.includes('following up') && painPoint.includes('quickly')) {
      solution += "Our AI responds to every lead within 5 seconds, 24/7. It answers questions, qualifies them based on YOUR criteria, and books appointments automatically. Imagine never losing another lead to slow follow-up - your competition won't know what hit them!";
      this.recommendedServices = ['AI Voice Calls', 'SMS Follow-Ups', 'Appointment Bookings'];
    } else if (painPoint.includes('miss calls')) {
      solution += "Our AI Voice system answers every single call, day or night, weekends, holidays - always. It sounds completely natural, qualifies callers, and if they can't talk, it automatically texts them to continue the conversation. You'll literally never miss another opportunity.";
      this.recommendedServices = ['AI Voice Calls', 'SMS Follow-Ups'];
    } else if (painPoint.includes('generating') && painPoint.includes('leads')) {
      solution += "We have three powerful ways to generate more leads: AI Texting on your website captures visitors instantly, SMS Revive wakes up your old database, and our Review Collector boosts your online reputation so people choose you first.";
      this.recommendedServices = ['AI Texting', 'SMS Revive', 'Review Collector'];
    } else {
      solution += "Our AI system handles all your customer interactions automatically - from initial contact to booking appointments. Everything integrates seamlessly with your current systems.";
      this.recommendedServices = ['Complete AI System'];
    }
    
    // Add business-specific context
    if (businessType.toLowerCase().includes('real estate')) {
      solution += " For real estate specifically, we help you respond to every lead faster than your competition, so you win more listings!";
    }
    
    this.conversationManager.conversationFlow.solutionPresented = true;
    return solution;
  }

  /**
   * Generate scheduling offer
   */
  async generateSchedulingOffer() {
    const firstName = this.connectionData.firstName || '';
    const company = this.connectionData.companyName || 'your business';
    
    return `You know what, ${firstName}? I'd love to show you exactly how this would work for ${company}. Our founder Jaden does these personalized demo calls where he can show you the system live and create a custom solution just for you. It's completely free and super valuable. Would you be interested in seeing it in action?`;
  }

  /**
   * Analyze user sentiment
   */
  analyzeSentiment(message) {
    const lower = message.toLowerCase();
    const positiveWords = ['good', 'great', 'well', 'fine', 'awesome', 'excellent'];
    const negativeWords = ['bad', 'not good', 'terrible', 'struggling', 'tough'];
    
    if (positiveWords.some(word => lower.includes(word))) return 'positive';
    if (negativeWords.some(word => lower.includes(word))) return 'negative';
    return 'neutral';
  }

  /**
   * Build comprehensive conversation state
   */
  buildConversationState(userMessage) {
    const phase = this.conversationManager?.getState().phase || 'greeting';
    
    return {
      phase: phase,
      customerProfile: {
        email: this.connectionData.customerEmail,
        name: this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        industry: this.connectionData.business_type || this.connectionData.companyName,
        painPoint: this.connectionData.painPoint
      },
      questionsCompleted: this.conversationManager?.getState().questionsCompleted || 0,
      duration: (Date.now() - this.conversationMetrics.startTime) / 1000,
      customerEngagement: this.calculateEngagementLevel(),
      painPointAcknowledged: this.conversationManager?.conversationFlow.painPointAcknowledged || false,
      rapportBuilt: this.conversationManager?.conversationFlow.rapportBuilt || false,
      solutionPresented: this.conversationManager?.conversationFlow.solutionPresented || false,
      schedulingOffered: this.conversationManager?.conversationFlow.schedulingOffered || false,
      smoothTransitions: this.conversationMetrics.smoothTransitions,
      repeatedQuestions: this.conversationMetrics.repeatedQuestions,
      currentScore: this.calculateCurrentScore(),
      recentHistory: this.getRecentHistory(),
      baseSystemPrompt: this.getEnhancedSystemPrompt(),
      responseTracking: this.conversationMetrics.responses
    };
  }

  /**
   * Track user engagement signals
   */
  trackUserEngagement(userMessage) {
    const lowerMessage = userMessage.toLowerCase();
    
    // Track message length
    this.conversationMetrics.userMessageLengths.push(userMessage.length);
    
    // Check for positive signals
    if (this.conversationMetrics.positiveSignals.some(signal => lowerMessage.includes(signal))) {
      this.conversationMetrics.userEngagementSignals++;
      this.conversationMetrics.smoothTransitions++;
    }
    
    // Check for negative signals
    if (this.conversationMetrics.negativeSignals.some(signal => lowerMessage.includes(signal))) {
      this.conversationMetrics.disengagementSignals++;
    }
    
    // Track objections
    const objectionKeywords = ['price', 'cost', 'expensive', 'budget', 'think about it', 'not sure'];
    objectionKeywords.forEach(keyword => {
      if (lowerMessage.includes(keyword)) {
        this.conversationMetrics.objections.push({
          type: keyword,
          message: userMessage,
          timestamp: Date.now()
        });
      }
    });
  }

  /**
   * Track response metrics
   */
  trackResponseMetrics(response) {
    const responseTime = Date.now() - this.lastResponseTime;
    
    this.conversationMetrics.responseTimeSum += responseTime;
    this.conversationMetrics.responseCount++;
    this.conversationMetrics.averageResponseTime = 
      this.conversationMetrics.responseTimeSum / this.conversationMetrics.responseCount;
    
    this.conversationMetrics.responses.push({
      content: response,
      timestamp: Date.now(),
      responseTime: responseTime,
      phase: this.conversationManager?.getState().phase || 'unknown'
    });
  }

  /**
   * Calculate current engagement level
   */
  calculateEngagementLevel() {
    const avgMessageLength = this.conversationMetrics.userMessageLengths.length > 0
      ? this.conversationMetrics.userMessageLengths.reduce((a, b) => a + b) / this.conversationMetrics.userMessageLengths.length
      : 10;
    
    if (this.conversationMetrics.disengagementSignals > 2) return 'low';
    if (this.conversationMetrics.userEngagementSignals > 3 && avgMessageLength > 20) return 'high';
    if (avgMessageLength > 15) return 'medium';
    return 'low';
  }

  /**
   * Calculate current conversation score
   */
  calculateCurrentScore() {
    let score = 50; // Base score
    
    // Positive factors
    score += this.conversationMetrics.userEngagementSignals * 5;
    score += this.conversationMetrics.smoothTransitions * 3;
    if (this.conversationManager?.conversationFlow.painPointAcknowledged) score += 10;
    if (this.conversationManager?.conversationFlow.solutionPresented) score += 10;
    
    // Negative factors
    score -= this.conversationMetrics.disengagementSignals * 10;
    score -= this.conversationMetrics.repeatedQuestions * 5;
    score -= this.conversationMetrics.abruptTransitions * 5;
    score -= this.conversationMetrics.missedCues * 8;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get recent conversation history
   */
  getRecentHistory() {
    // Get last 5 messages
    const history = [];
    if (this.conversationManager && this.conversationManager.conversationHistory) {
      return this.conversationManager.conversationHistory.slice(-5);
    }
    return history;
  }

  /**
   * Get enhanced system prompt with learnings
   */
  getEnhancedSystemPrompt() {
    let prompt = `You are Sarah from Nexella AI, a warm and friendly customer success specialist.

CUSTOMER CONTEXT:
- Name: ${this.connectionData.firstName || 'there'}
- Company: ${this.connectionData.companyName || 'their business'}
- Industry: ${this.connectionData.business_type || 'unknown'}
- Pain Point: ${this.connectionData.painPoint || 'not specified yet'}

CRITICAL: The customer already told us their pain point via form submission. Do NOT ask about it again.

CONVERSATION PHASE: ${this.conversationManager?.getState().phase || 'greeting'}

LEARNING-BASED GUIDELINES:
- Current engagement level: ${this.calculateEngagementLevel()}
- Conversation score: ${this.calculateCurrentScore()}/100`;

    // Add specific guidance based on metrics
    if (this.conversationMetrics.disengagementSignals > 0) {
      prompt += '\n- Customer showing disengagement - be more enthusiastic and ask engaging questions';
    }
    
    if (this.conversationMetrics.objections.length > 0) {
      prompt += '\n- Customer has objections - address concerns and build value';
    }
    
    if (this.conversationManager?.getState().phase === 'solution') {
      prompt += '\n- Focus on presenting solution clearly and building excitement';
    }
    
    return prompt;
  }

  /**
   * Apply suggested action from learning module
   */
  async applySuggestedAction(suggestedAction, responseId) {
    console.log('🎯 Applying learned action:', suggestedAction.action);
    
    // Map actions to responses
    const actionResponses = {
      'acknowledge_pain_point': async () => {
        const painPoint = this.connectionData.painPoint;
        return `I completely understand. ${painPoint} is a real challenge that many businesses face. Let me show you exactly how we've helped others overcome this...`;
      },
      'present_solution': async () => {
        return await this.generateSolutionResponse();
      },
      'create_urgency': async () => {
        return "You know what? I actually have some time slots opening up this week. Would you like me to check what's available?";
      },
      'handle_objection': async () => {
        const lastObjection = this.conversationMetrics.objections[this.conversationMetrics.objections.length - 1];
        if (lastObjection?.type === 'price') {
          return "I understand cost is important. That's why we focus on ROI - our clients typically see returns within 60 days. Let me show you how...";
        }
        return "I hear your concern. Let me address that...";
      },
      'offer_scheduling': async () => {
        return await this.generateSchedulingOffer();
      },
      'continue_current_approach': async () => {
        return null; // Let normal flow continue
      }
    };
    
    const actionHandler = actionResponses[suggestedAction.action];
    if (actionHandler) {
      const response = await actionHandler();
      if (response) {
        await this.sendSingleResponse(response, responseId);
      }
    }
  }

  /**
   * Override handleClose to trigger learning
   */
  async handleClose() {
    console.log('🔌 Connection closing - triggering learning process');
    
    // Prepare call data for scoring - FIX: Ensure customerName is set
    const callData = {
      callId: this.callId,
      customerEmail: this.connectionData.customerEmail,
      customerName: this.connectionData.customerName || 
                   `${this.connectionData.firstName || ''} ${this.connectionData.lastName || ''}`.trim() ||
                   'Unknown Customer',
      companyName: this.connectionData.companyName,
      industry: this.connectionData.business_type,
      painPoint: this.connectionData.painPoint,
      appointmentBooked: this.appointmentBooked,
      schedulingOffered: this.conversationManager?.conversationFlow.schedulingOffered || false,
      questionsCompleted: 0, // Since we skip discovery with Typeform
      conversationPhase: this.conversationManager?.getState().phase || 'unknown',
      duration: (Date.now() - this.connectionStartTime) / 1000,
      averageResponseTime: this.conversationMetrics.averageResponseTime,
      averageUserResponseLength: this.calculateAverageUserResponseLength(),
      positiveEngagementSignals: this.conversationMetrics.userEngagementSignals,
      negativeEngagementSignals: this.conversationMetrics.disengagementSignals,
      smoothTransitions: this.conversationMetrics.smoothTransitions,
      abruptTransitions: this.conversationMetrics.abruptTransitions,
      missedCues: this.conversationMetrics.missedCues,
      repeatedQuestions: this.conversationMetrics.repeatedQuestions,
      bookingAttempted: this.conversationMetrics.bookingAttempted,
      objections: this.conversationMetrics.objections,
      responseTracking: this.conversationMetrics.responses,
      painPointAcknowledged: this.conversationManager?.conversationFlow.painPointAcknowledged || false,
      solutionPresented: this.conversationManager?.conversationFlow.solutionPresented || false,
      servicesRecommended: this.recommendedServices || []
    };
    
    try {
      // Score the call
      const scoringResult = await this.learningModule.scoreCall(callData);
      console.log('📊 Call scored:', scoringResult.finalScore, '/100');
      console.log('💪 Strengths:', scoringResult.strengths.map(s => s.area));
      console.log('📈 Improvements:', scoringResult.improvements.map(i => i.area));
      
      // Let adaptive generator learn from this conversation
      await this.adaptiveGenerator.learnFromConversation(callData, scoringResult.finalScore);
      
      // Trigger system-wide learning if this was a high-scoring call
      if (scoringResult.finalScore >= 80) {
        console.log('🌟 High-scoring call - updating global strategies');
        await this.learningModule.learnFromHistory(10); // Analyze last 10 calls
      }
      
      // Store learning metrics in webhook data
      if (this.connectionData.customerEmail) {
        await this.sendLearningMetricsWebhook(scoringResult);
      }
      
    } catch (error) {
      console.error('❌ Error in learning process:', error);
    }
    
    // Call parent handleClose
    await super.handleClose();
  }

  /**
   * Calculate average user response length
   */
  calculateAverageUserResponseLength() {
    if (this.conversationMetrics.userMessageLengths.length === 0) return 0;
    
    const sum = this.conversationMetrics.userMessageLengths.reduce((a, b) => a + b, 0);
    return sum / this.conversationMetrics.userMessageLengths.length;
  }

  /**
   * Send learning metrics via webhook
   */
  async sendLearningMetricsWebhook(scoringResult) {
    try {
      const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');
      
      await sendSchedulingPreference(
        this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        'Learning metrics',
        this.callId,
        {
          call_score: scoringResult.finalScore,
          strengths: scoringResult.strengths.map(s => s.area).join(', '),
          improvements: scoringResult.improvements.map(i => i.area).join(', '),
          engagement_level: this.calculateEngagementLevel(),
          questions_completed: 0, // We skip discovery with Typeform
          conversation_duration: Math.round((Date.now() - this.connectionStartTime) / 1000),
          learning_points: scoringResult.learningPoints.length
        }
      );
      
    } catch (error) {
      console.error('Error sending learning metrics:', error);
    }
  }
}

module.exports = WebSocketHandlerWithLearning;
