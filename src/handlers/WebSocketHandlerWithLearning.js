// src/handlers/WebSocketHandlerWithLearning.js - FIXED VERSION WITH PROPER RAPPORT AND BOOKING
const WebSocketHandlerWithMemory = require('./WebSocketHandlerWithMemory');
const SelfScoringLearningModule = require('../services/learning/SelfScoringLearningModule');
const AdaptiveResponseGenerator = require('../services/learning/AdaptiveResponseGenerator');

class WebSocketHandlerWithLearning extends WebSocketHandlerWithMemory {
  constructor(ws, req) {
    super(ws, req);
    
    // Initialize learning components
    this.learningModule = new SelfScoringLearningModule();
    this.adaptiveGenerator = new AdaptiveResponseGenerator(this.memoryService);

    // Add this method to your WebSocketHandlerWithLearning class

/**
 * Detect if the message is from a voicemail system
 */
isVoicemailMessage(userMessage) {
  const voicemailPhrases = [
    'at the tone',
    'please record your message',
    'when you\'ve finished recording',
    'simply hang up',
    'press pound',
    'further options',
    'leave a message',
    'voicemail',
    'the person you are trying to reach',
    'is not available',
    'mailbox',
    'beep'
  ];
  
  const messageLower = userMessage.toLowerCase();
  return voicemailPhrases.some(phrase => messageLower.includes(phrase));
}

/**
 * Detect if we're connected to a voicemail system
 */
detectVoicemailConnection(recentMessages) {
  // Check last 3 messages for voicemail patterns
  const voicemailCount = recentMessages
    .slice(-3)
    .filter(msg => this.isVoicemailMessage(msg))
    .length;
  
  return voicemailCount >= 2; // If 2 out of last 3 messages are voicemail-related
}

/**
 * Updated processUserMessage to handle voicemail detection
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
  
  // CRITICAL: Check for voicemail
  if (this.isVoicemailMessage(userMessage)) {
    console.log('📞 VOICEMAIL DETECTED - Ignoring message');
    
    // Track voicemail messages
    if (!this.voicemailMessages) {
      this.voicemailMessages = [];
    }
    this.voicemailMessages.push(userMessage);
    
    // If we detect consistent voicemail messages, we might want to end the call
    if (this.voicemailMessages.length >= 3) {
      console.log('📞 VOICEMAIL SYSTEM DETECTED - Consider ending call');
      // You could trigger a call end here or send a specific response
      await this.sendSingleResponse("It seems I've reached your voicemail. I'll try calling back later. Have a great day!", parsed.response_id);
      
      // Optional: Trigger call end
      // this.ws.close();
    }
    
    return; // Don't process voicemail messages
  }
  
  // Also ignore phone number recitations (common in voicemail)
  if (userMessage.match(/^(telephone number|phone number)?\s*[\d\s]+$/i)) {
    console.log('📞 Phone number recitation detected - likely voicemail');
    return;
  }
  
  // Rest of your existing processUserMessage code...
  // Mark that user has spoken
  if (!this.userHasSpoken && userMessage.trim()) {
    this.userHasSpoken = true;
    console.log('✅ User has spoken - starting conversation');
  }
  
  // Continue with normal processing...
}
    
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
      positiveSignals: ['sounds good', 'great', 'yes', 'sure', 'interested', 'tell me more', 'good', 'well', 'fine'],
      negativeSignals: ['not interested', 'no', 'busy', 'later', 'goodbye', 'stop']
    };
    
    // Track if user has spoken
    this.userHasSpoken = false;
    this.greetingSent = false;
    
    // CRITICAL: Track conversation state properly
    this.waitingForResponse = false;
    this.lastQuestionAsked = null;
    
    // CRITICAL: Proper response timing
    this.minimumResponseDelay = 3000; // 3 seconds minimum between responses
    
    console.log('🧠 Self-Learning WebSocket Handler initialized');
  }

  /**
   * Override initialization to set proper phase based on Typeform data
   */
  async initialize() {
    await super.initialize();
    
    // CRITICAL FIX: If we have Typeform data with pain point, prepare for personalized flow
    if (this.connectionData.painPoint && this.connectionData.firstName) {
      console.log('📋 Have Typeform data - will use personalized conversation flow');
      
      // Set conversation manager to greeting phase
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
      questionsCompleted: conversationState.questionsCompleted,
      waitingForResponse: this.waitingForResponse,
      lastQuestion: this.lastQuestionAsked
    });
    
    // CRITICAL FIX: Don't get stuck in loops
    if (this.responseInProgress) {
      console.log('🚫 Response already in progress, skipping');
      return;
    }
    
    // Get suggested action from learning module
    const suggestedAction = await this.learningModule.suggestNextBestAction(conversationState);
    
    console.log('🎯 Learning suggestion:', suggestedAction);
    
    // CRITICAL FIX: Handle conversation flow properly
    let response = null;
    
    // Handle greeting phase
    if (!this.greetingSent && this.userHasSpoken) {
      response = await this.generateGreeting();
      this.greetingSent = true;
      this.waitingForResponse = true;
      this.lastQuestionAsked = 'how_are_you';
      this.conversationManager.conversationFlow.phase = 'greeting';
    } 
    // Handle rapport building - WAIT for response to "How are you?"
    else if (this.waitingForResponse && this.lastQuestionAsked === 'how_are_you') {
      this.waitingForResponse = false;
      response = await this.generateRapportResponse(userMessage);
      this.conversationManager.conversationFlow.rapportBuilt = true;
      this.conversationManager.conversationFlow.phase = 'pain_point_acknowledge';
    }
    // Handle pain point acknowledgment
    else if (conversationState.phase === 'pain_point_acknowledge' && !conversationState.painPointAcknowledged) {
      // Wait a moment for user to process rapport response
      this.waitingForResponse = true;
      this.lastQuestionAsked = 'pain_point_acknowledge';
      // Don't send a response yet - wait for user acknowledgment
      return;
    }
    // Handle user acknowledgment of pain point
    else if (this.waitingForResponse && this.lastQuestionAsked === 'pain_point_acknowledge') {
      this.waitingForResponse = false;
      this.conversationManager.conversationFlow.painPointAcknowledged = true;
      this.conversationManager.conversationFlow.phase = 'solution';
      response = "So here's the good news...";
      
      // Queue solution presentation after a delay
      setTimeout(async () => {
        if (!this.responseInProgress && !this.appointmentBooked) {
          const solutionResponse = await this.generateSolutionResponse();
          await this.sendSingleResponse(solutionResponse, Date.now());
          this.conversationManager.conversationFlow.solutionPresented = true;
          
          // Queue scheduling offer after solution
          setTimeout(async () => {
            if (!this.responseInProgress && !this.appointmentBooked) {
              const schedulingOffer = await this.generateSchedulingOffer();
              await this.sendSingleResponse(schedulingOffer, Date.now());
              this.conversationManager.conversationFlow.phase = 'scheduling';
              this.conversationManager.conversationFlow.schedulingOffered = true;
            }
          }, 4000); // 4 seconds after solution
        }
      }, 2000); // 2 seconds after "good news"
    }
    // Handle scheduling response
    else if (conversationState.phase === 'scheduling' || conversationState.schedulingOffered) {
      const userLower = userMessage.toLowerCase();
      
      // Check for positive scheduling intent
      if (userLower.includes('yes') || userLower.includes('yeah') || userLower.includes('sure') || 
          userLower.includes('ok') || userLower.includes('sounds good') || userLower.includes('interested')) {
        response = "Awesome! Let me check our calendar. What day works best for you this week?";
        this.conversationManager.conversationFlow.phase = 'booking';
        this.conversationManager.conversationFlow.bookingInProgress = true;
      } else {
        // Handle booking phase directly
        await this.handleBookingPhase(userMessage, parsed.response_id);
        return;
      }
    }
    // Handle booking phase
    else if (conversationState.phase === 'booking' || this.conversationManager?.conversationFlow.bookingInProgress) {
      await this.handleBookingPhase(userMessage, parsed.response_id);
      return;
    }
    
    // Send response if we have one
    if (response) {
      this.trackResponseMetrics(response);
      await this.sendSingleResponse(response, parsed.response_id);
    }
  }

  /**
   * Override handleBookingPhase to fix booking issues
   */
  async handleBookingPhase(userMessage, responseId) {
    console.log('📅 Processing booking request:', userMessage);
    
    // CRITICAL FIX: Use the parent class booking manager properly
    if (this.bookingManager) {
      const bookingResponse = await this.bookingManager.processBookingRequest(userMessage);
      
      if (bookingResponse) {
        await this.sendSingleResponse(bookingResponse, responseId);
        
        // Check if booking is complete
        const bookingState = this.bookingManager.getState();
        if (bookingState.bookingCompleted) {
          this.appointmentBooked = true;
          this.conversationManager.markBookingComplete();
          
          // Send webhook with booking details
          await this.sendBookingWebhook();
        }
      }
    } else {
      // Fallback if booking manager not available
      await this.sendSingleResponse("Let me help you schedule that appointment. What day works best?", responseId);
    }
  }

  /**
   * Generate personalized greeting using Typeform data
   */
  async generateGreeting() {
    const firstName = this.connectionData.firstName || 'there';
    return `Hi ${firstName}! This is Sarah from Nexella AI. How are you doing today?`;
  }

  /**
   * Generate rapport response that acknowledges pain point
   */
  async generateRapportResponse(userMessage) {
    const sentiment = this.analyzeSentiment(userMessage);
    const firstName = this.connectionData.firstName || '';
    const painPoint = this.connectionData.painPoint;
    const company = this.connectionData.companyName;
    
    let response = '';
    
    // CRITICAL: Actually respond to their answer about how they're doing
    const userLower = userMessage.toLowerCase();
    
    if (sentiment === 'positive' || userLower.includes('good') || userLower.includes('well') || userLower.includes('great')) {
      response = "That's great to hear! ";
    } else if (sentiment === 'negative' || userLower.includes('bad') || userLower.includes('not good')) {
      response = "I'm sorry to hear that. I hope things get better for you. ";
    } else if (userLower.includes('how are you') || userLower.includes('you?')) {
      response = "I'm doing well, thank you for asking! ";
    } else {
      response = "Thanks for letting me know. ";
    }
    
    // Add pain point acknowledgment
    if (painPoint) {
      const painLower = painPoint.toLowerCase();
      
      if (painLower.includes('miss calls')) {
        response += `So I was looking at your form, and I see that you're missing too many calls${company ? ' at ' + company : ''}. That must be really frustrating when each call could be your next big deal...`;
      } else if (painLower.includes('following up') && painLower.includes('quickly')) {
        response += `I noticed from your form that you're struggling with following up with leads quickly enough${company ? ' at ' + company : ''}. Time is everything in business, isn't it? You know those first few minutes are critical...`;
      } else if (painLower.includes('generating') && painLower.includes('leads')) {
        response += `So I saw from your form that generating enough leads is a challenge${company ? ' for ' + company : ''}. That's tough, especially with how competitive things are these days...`;
      } else if (painLower.includes('handle') && painLower.includes('amount')) {
        response += `I see from your form that you're overwhelmed with the volume of leads${company ? ' at ' + company : ''}. What a great problem to have, but I know it's still really stressful when you can't give everyone the attention they deserve...`;
      } else {
        response += `I saw from your form that you're dealing with "${painPoint}"${company ? ' at ' + company : ''}. That sounds really challenging...`;
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
    
    if (painPoint.includes('miss calls')) {
      solution += "Our AI Voice system answers every single call, 24/7, and sounds just like a real person. It qualifies callers based on YOUR criteria, and if they can't talk right then, it automatically texts them to continue the conversation. You'll literally never miss another opportunity.";
      this.recommendedServices = ['AI Voice Calls', 'SMS Follow-Ups'];
    } else if (painPoint.includes('following up') && painPoint.includes('quickly')) {
      solution += "Our AI responds to every lead within 5 seconds, 24/7. It answers their questions, qualifies them based on YOUR criteria, and books appointments automatically. While your competition is still checking voicemail, you've already secured the appointment!";
      this.recommendedServices = ['AI Voice Calls', 'SMS Follow-Ups', 'Appointment Bookings'];
    } else if (painPoint.includes('generating') && painPoint.includes('leads')) {
      solution += "We have three powerful ways to generate more leads: Our AI Texting on your website captures visitors instantly when they're most interested, SMS Revive wakes up all those old leads in your database, and our Review Collector boosts your online reputation so more people choose you first.";
      this.recommendedServices = ['AI Texting', 'SMS Revive', 'Review Collector'];
    } else if (painPoint.includes('handle') && painPoint.includes('amount')) {
      solution += "Our complete automation suite handles unlimited leads simultaneously. Every lead gets instant attention, proper qualification, and automatic scheduling. Your CRM stays updated automatically so nothing falls through the cracks. Your team can focus on closing deals instead of juggling calls.";
      this.recommendedServices = ['Complete Automation Suite', 'CRM Integration'];
    } else {
      solution += "Our AI system handles all your customer interactions automatically - from initial contact to booking appointments. Everything integrates seamlessly with your current systems, so you can focus on what you do best.";
      this.recommendedServices = ['Complete AI System'];
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
    
    return `You know what${firstName ? ', ' + firstName : ''}? I'd love to show you exactly how this would work for ${company}. Our founder Jaden does these personalized demo calls where he can show you the system live and create a custom solution just for you. It's completely free and super valuable. Would you be interested in seeing it in action?`;
  }

  /**
   * Override sendSingleResponse to ensure proper timing
   */
  async sendSingleResponse(content, responseId) {
    // CRITICAL: Prevent multiple responses
    if (this.responseInProgress) {
      console.log('🚫 Response already in progress, skipping');
      return;
    }
    
    // Apply rate limiting
    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTime;
    
    if (timeSinceLastResponse < this.minimumResponseDelay) {
      const waitTime = this.minimumResponseDelay - timeSinceLastResponse;
      console.log(`⏳ Waiting ${waitTime}ms before sending response`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.responseInProgress = true;
    
    try {
      console.log('🤖 Sending:', content);
      
      this.ws.send(JSON.stringify({
        content: content,
        content_complete: true,
        actions: [],
        response_id: responseId || Date.now()
      }));
      
      this.lastResponseTime = Date.now();
      if (this.conversationManager) {
        this.conversationManager.updateResponseTime();
      }
      
    } finally {
      // Always clear the response lock after a short delay
      setTimeout(() => {
        this.responseInProgress = false;
      }, 500);
    }
  }

  /**
   * Send booking webhook
   */
  async sendBookingWebhook() {
    try {
      const bookingState = this.bookingManager.getState();
      const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');
      
      await sendSchedulingPreference(
        this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        bookingState.selectedDay || 'Appointment booked',
        this.callId,
        {
          first_name: this.connectionData.firstName,
          last_name: this.connectionData.lastName,
          company_name: this.connectionData.companyName,
          pain_point: this.connectionData.painPoint,
          appointment_booked: true,
          booking_confirmed: true
        }
      );
      
      console.log('✅ Booking webhook sent');
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  }

  /**
   * Analyze user sentiment
   */
  analyzeSentiment(message) {
    const lower = message.toLowerCase();
    
    const positiveWords = ['good', 'great', 'awesome', 'excellent', 'fantastic', 'well', 'fine', 'alright', 'okay', 'wonderful'];
    const negativeWords = ['bad', 'terrible', 'awful', 'struggling', 'tough', 'hard', 'stressed', 'rough', 'not good', 'not well'];
    
    if (positiveWords.some(word => lower.includes(word))) {
      return 'positive';
    } else if (negativeWords.some(word => lower.includes(word))) {
      return 'negative';
    }
    
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
    if (this.conversationManager?.conversationFlow.rapportBuilt) score += 10;
    
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

CRITICAL: The customer already told us their pain point via form submission. Build rapport by:
1. Greeting them warmly by name
2. Asking how they're doing
3. WAITING for their response
4. Responding appropriately to their answer
5. Then acknowledging their pain point with empathy

CONVERSATION PHASE: ${this.conversationManager?.getState().phase || 'greeting'}

LEARNING-BASED GUIDELINES:
- Current engagement level: ${this.calculateEngagementLevel()}
- Conversation score: ${this.calculateCurrentScore()}/100
- Waiting for response: ${this.waitingForResponse}
- Last question asked: ${this.lastQuestionAsked}`;

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
   * Override handleClose to trigger learning
   */
  async handleClose() {
    console.log('🔌 Connection closing - triggering learning process');
    
    // Prepare call data for scoring
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
      rapportBuilt: this.conversationManager?.conversationFlow.rapportBuilt || false,
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
