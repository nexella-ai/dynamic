// src/handlers/WebSocketHandlerWithLearning.js
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
    
    console.log('🧠 Self-Learning WebSocket Handler initialized');
  }

  /**
   * Override processUserMessage to use adaptive responses
   */
  async processUserMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    
    // Track metrics
    this.trackUserEngagement(userMessage);
    
    // Build current conversation state
    const conversationState = this.buildConversationState(userMessage);
    
    // Get suggested action from learning module
    const suggestedAction = await this.learningModule.suggestNextBestAction(conversationState);
    
    console.log('🎯 Learning suggestion:', suggestedAction);
    
    // Check if we should apply the suggestion
    if (suggestedAction.confidence > 0.7) {
      await this.applySuggestedAction(suggestedAction, parsed.response_id);
      return;
    }
    
    // Otherwise, use adaptive response generation
    const response = await this.adaptiveGenerator.generateAdaptiveResponse(
      conversationState,
      userMessage
    );
    
    // Track response metrics
    this.trackResponseMetrics(response);
    
    // Send response
    await this.sendSingleResponse(response, parsed.response_id);
  }

  /**
   * Build comprehensive conversation state
   */
  buildConversationState(userMessage) {
    const phase = this.conversationManager?.getState().phase || 'unknown';
    
    return {
      phase: phase,
      customerProfile: {
        email: this.connectionData.customerEmail,
        name: this.connectionData.customerName,
        industry: this.connectionData.business_type || this.connectionData.companyName,
        painPoint: this.connectionData.painPoint
      },
      questionsCompleted: this.conversationManager?.getState().questionsCompleted || 0,
      duration: (Date.now() - this.conversationMetrics.startTime) / 1000,
      customerEngagement: this.calculateEngagementLevel(),
      painPointAcknowledged: this.conversationManager?.getState().painPointAcknowledged || false,
      schedulingOffered: this.conversationManager?.getState().schedulingOffered || false,
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
    score += (this.conversationManager?.getState().questionsCompleted || 0) * 5;
    
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
    // Get last 5 messages from conversation history
    const history = this.conversationManager?.conversationHistory || [];
    return history.slice(-5).map(msg => ({
      role: msg.role === 'system' ? 'assistant' : msg.role,
      content: msg.content
    }));
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
      'ask_discovery_question': async () => {
        const nextQuestion = this.conversationManager?.getNextUnansweredQuestion();
        return nextQuestion || "Tell me more about your current situation.";
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
    
    // Prepare call data for scoring
    const callData = {
      callId: this.callId,
      customerEmail: this.connectionData.customerEmail,
      customerName: this.connectionData.customerName,
      companyName: this.connectionData.companyName,
      industry: this.connectionData.business_type,
      painPoint: this.connectionData.painPoint,
      appointmentBooked: this.appointmentBooked,
      schedulingOffered: this.conversationManager?.getState().schedulingOffered || false,
      questionsCompleted: this.conversationManager?.getState().questionsCompleted || 0,
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
      painPointAcknowledged: this.conversationManager?.getState().painPointAcknowledged || false,
      solutionPresented: this.conversationManager?.getState().solutionPresented || false,
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
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        'Learning metrics',
        this.callId,
        {
          call_score: scoringResult.finalScore,
          strengths: scoringResult.strengths.map(s => s.area).join(', '),
          improvements: scoringResult.improvements.map(i => i.area).join(', '),
          engagement_level: this.calculateEngagementLevel(),
          questions_completed: this.conversationManager?.getState().questionsCompleted || 0,
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
