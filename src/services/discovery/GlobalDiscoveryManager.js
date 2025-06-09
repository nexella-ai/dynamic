// src/services/discovery/GlobalDiscoveryManager.js - FIXED WITH ENHANCED ANTI-LOOP PROTECTION
class GlobalDiscoveryManager {
  constructor() {
    // Global storage for all active discovery sessions
    this.activeSessions = new Map(); // callId -> discoveryState
    this.sessionTimeouts = new Map(); // callId -> timeout
    
    // Session expires after 30 minutes of inactivity
    this.SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    
    console.log('🧠 GlobalDiscoveryManager initialized');
  }

  // Get or create discovery session for a call
  getSession(callId, customerData = {}) {
    console.log('📞 GET SESSION CALLED');
    console.log('🆔 Call ID:', callId);
    console.log('👤 Customer Data:', customerData);

    if (!callId) {
      console.warn('⚠️ No callId provided to getSession');
      return this.createNewSession('temp_' + Date.now(), customerData);
    }

    // Check if session exists
    if (this.activeSessions.has(callId)) {
      const session = this.activeSessions.get(callId);
      console.log(`🔄 RETRIEVED EXISTING SESSION for ${callId}:`);
      console.log('   📊 Questions Completed:', session.progress.questionsCompleted);
      console.log('   🗓️ Scheduling Started:', session.progress.schedulingStarted);
      console.log('   📝 Conversation Phase:', session.progress.conversationPhase);
      console.log('   ⏳ Waiting for Answer:', session.progress.waitingForAnswer);
      
      // Refresh timeout
      this.refreshSessionTimeout(callId);
      return session;
    }

    // Create new session
    console.log(`🆕 CREATING NEW SESSION for ${callId}`);
    return this.createNewSession(callId, customerData);
  }

  // Create a new discovery session
  createNewSession(callId, customerData = {}) {
    const session = {
      callId: callId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      customerData: {
        email: customerData.customerEmail || customerData.email || '',
        name: customerData.customerName || customerData.name || '',
        phone: customerData.customerPhone || customerData.phone || ''
      },
      questions: [
        { question: 'How did you hear about us?', field: 'How did you hear about us', asked: false, answered: false, answer: '', askedAt: null },
        { question: 'What industry or business are you in?', field: 'Business/Industry', asked: false, answered: false, answer: '', askedAt: null },
        { question: 'What\'s your main product or service?', field: 'Main product', asked: false, answered: false, answer: '', askedAt: null },
        { question: 'Are you currently running any ads?', field: 'Running ads', asked: false, answered: false, answer: '', askedAt: null },
        { question: 'Are you using any CRM system?', field: 'Using CRM', asked: false, answered: false, answer: '', askedAt: null },
        { question: 'What are your biggest pain points or challenges?', field: 'Pain points', asked: false, answered: false, answer: '', askedAt: null }
      ],
      progress: {
        currentQuestionIndex: -1,
        questionsCompleted: 0,
        allQuestionsCompleted: false,
        waitingForAnswer: false,
        schedulingStarted: false,
        lastQuestionAsked: null,
        conversationPhase: 'greeting', // greeting -> discovery -> scheduling -> completed
        greetingCompleted: false
      },
      userResponseBuffer: [],
      isCapturingAnswer: false,
      discoveryData: {},
      lastBotMessageTimestamp: 0,
      antiLoop: {
        questionAskedCount: 0,
        lastQuestionAskedAt: 0,
        maxQuestionsPerMinute: 6,
        preventRepeatedQuestions: true,
        lastAnswerCapturedAt: 0,
        answerCaptureCount: 0,
        maxAnswerCapturesPerMinute: 10
      }
    };

    this.activeSessions.set(callId, session);
    this.refreshSessionTimeout(callId);
    
    console.log(`✅ Created session for ${callId} with customer data:`, session.customerData);
    return session;
  }

  // Update session activity and refresh timeout
  updateSessionActivity(callId) {
    if (this.activeSessions.has(callId)) {
      const session = this.activeSessions.get(callId);
      session.lastActivity = Date.now();
      this.refreshSessionTimeout(callId);
    }
  }

  // Refresh session timeout
  refreshSessionTimeout(callId) {
    // Clear existing timeout
    if (this.sessionTimeouts.has(callId)) {
      clearTimeout(this.sessionTimeouts.get(callId));
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      console.log(`⏰ Session ${callId} expired, cleaning up`);
      this.cleanupSession(callId);
    }, this.SESSION_TIMEOUT);

    this.sessionTimeouts.set(callId, timeout);
  }

  // ENHANCED: Question asking with comprehensive anti-loop protection
  markQuestionAsked(callId, questionIndex, botMessage) {
    const session = this.activeSessions.get(callId);
    if (!session) {
      console.log('❌ No session found for', callId);
      return false;
    }

    // ANTI-LOOP 1: Check if already asked recently (timing protection)
    const now = Date.now();
    if (session.antiLoop.lastQuestionAskedAt > 0) {
      const timeSinceLastQuestion = now - session.antiLoop.lastQuestionAskedAt;
      if (timeSinceLastQuestion < 3000) { // 3 seconds cooldown
        console.log(`🚫 ANTI-LOOP: Question asked too recently (${timeSinceLastQuestion}ms ago)`);
        return false;
      }
    }

    // ANTI-LOOP 2: Check question rate limiting
    const oneMinuteAgo = now - 60000;
    if (session.antiLoop.questionAskedCount > 0 && session.antiLoop.lastQuestionAskedAt > oneMinuteAgo) {
      if (session.antiLoop.questionAskedCount >= session.antiLoop.maxQuestionsPerMinute) {
        console.log(`🚫 ANTI-LOOP: Too many questions asked recently (${session.antiLoop.questionAskedCount} in last minute)`);
        return false;
      }
    } else {
      // Reset counter if more than a minute has passed
      session.antiLoop.questionAskedCount = 0;
    }

    if (questionIndex >= 0 && questionIndex < session.questions.length) {
      const question = session.questions[questionIndex];
      
      // ANTI-LOOP 3: Allow re-asking if not answered yet, but prevent excessive repetition
      if (question.asked && question.answered) {
        console.log(`🚫 ANTI-LOOP: Question ${questionIndex + 1} already answered`);
        return false;
      }
      
      // ANTI-LOOP 4: Prevent asking the same question too frequently
      if (question.asked && question.askedAt && (now - question.askedAt) < 10000) { // 10 seconds
        console.log(`🚫 ANTI-LOOP: Question ${questionIndex + 1} asked too recently`);
        return false;
      }
      
      question.asked = true;
      question.askedAt = now;
      session.progress.currentQuestionIndex = questionIndex;
      session.progress.waitingForAnswer = true;
      session.progress.lastQuestionAsked = question.question;
      session.lastBotMessageTimestamp = now;
      session.antiLoop.lastQuestionAskedAt = now;
      session.antiLoop.questionAskedCount++;
      
      console.log(`✅ MARKED Q${questionIndex + 1} as asked for ${callId}: "${question.question}"`);
      console.log(`📊 Now waiting for answer to Q${questionIndex + 1}`);
      this.updateSessionActivity(callId);
      return true;
    }
    return false;
  }

  // ENHANCED: Answer capture with comprehensive validation and anti-loop protection
  captureAnswer(callId, questionIndex, answer) {
    const session = this.activeSessions.get(callId);
    if (!session) {
      console.log('❌ No session found for answer capture:', callId);
      return false;
    }

    // ANTI-LOOP 1: Check answer capture rate limiting
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    if (session.antiLoop.lastAnswerCapturedAt > oneMinuteAgo) {
      if (session.antiLoop.answerCaptureCount >= session.antiLoop.maxAnswerCapturesPerMinute) {
        console.log(`🚫 ANTI-LOOP: Too many answer captures recently (${session.antiLoop.answerCaptureCount} in last minute)`);
        return false;
      }
    } else {
      // Reset counter if more than a minute has passed
      session.antiLoop.answerCaptureCount = 0;
    }

    // Validate input
    if (questionIndex < 0 || questionIndex >= session.questions.length) {
      console.log(`🚫 Invalid question index ${questionIndex}`);
      return false;
    }

    const question = session.questions[questionIndex];
    
    // ANTI-LOOP 2: Check if already answered recently
    if (question.answered) {
      console.log(`🚫 Question ${questionIndex + 1} already answered`);
      return false;
    }

    // ANTI-LOOP 3: Validate answer quality with enhanced checking
    if (!this.isValidAnswer(answer, questionIndex)) {
      console.log(`🚫 Invalid answer rejected: "${answer}"`);
      return false;
    }

    // ANTI-LOOP 4: Prevent rapid answer capturing
    if (session.antiLoop.lastAnswerCapturedAt > 0) {
      const timeSinceLastCapture = now - session.antiLoop.lastAnswerCapturedAt;
      if (timeSinceLastCapture < 1000) { // 1 second minimum between captures
        console.log(`🚫 ANTI-LOOP: Answer capture too rapid (${timeSinceLastCapture}ms ago)`);
        return false;
      }
    }

    // CAPTURE THE ANSWER
    question.answered = true;
    question.answer = answer.trim();
    
    session.discoveryData[question.field] = answer.trim();
    session.discoveryData[`question_${questionIndex}`] = answer.trim();
    
    session.progress.questionsCompleted++;
    session.progress.waitingForAnswer = false;
    session.progress.allQuestionsCompleted = session.questions.every(q => q.answered);
    
    // Update anti-loop tracking
    session.antiLoop.lastAnswerCapturedAt = now;
    session.antiLoop.answerCaptureCount++;
    
    // Auto-transition to scheduling if all done
    if (session.progress.allQuestionsCompleted && !session.progress.schedulingStarted) {
      console.log('🎉 ALL QUESTIONS COMPLETE - AUTO-TRANSITIONING TO SCHEDULING');
      session.progress.schedulingStarted = true;
      session.progress.conversationPhase = 'scheduling';
    }
    
    console.log(`✅ CAPTURED answer for ${callId} Q${questionIndex + 1}: "${answer}"`);
    console.log(`📊 Progress: ${session.progress.questionsCompleted}/6 questions completed`);
    console.log(`⏳ Waiting for answer: ${session.progress.waitingForAnswer}`);
    
    this.updateSessionActivity(callId);
    return true;
  }

  // ENHANCED: Better answer validation with context awareness
  isValidAnswer(answer, questionIndex = -1) {
    if (!answer || typeof answer !== 'string') return false;
    
    const cleaned = answer.trim().toLowerCase();
    
    // Reject too short answers
    if (cleaned.length < 2) return false;
    
    // Reject obvious question echoes
    const questionEchoes = [
      'how did you hear',
      'what industry',
      'what business',
      'main product',
      'running ads',
      'crm system',
      'pain points',
      'biggest challenges'
    ];
    
    for (const echo of questionEchoes) {
      if (cleaned.includes(echo)) {
        console.log(`🚫 Rejected question echo: "${cleaned}" contains "${echo}"`);
        return false;
      }
    }
    
    // ENHANCED: Reject obvious scheduling requests when expecting discovery answers
    if (questionIndex >= 0 && questionIndex < 6) {
      const schedulingKeywords = [
        'tuesday at', 'wednesday at', 'monday at', 'thursday at', 'friday at',
        'schedule', 'book appointment', 'what times', 'available'
      ];
      
      for (const keyword of schedulingKeywords) {
        if (cleaned.includes(keyword)) {
          console.log(`🚫 Rejected scheduling request as discovery answer: "${cleaned}"`);
          return false;
        }
      }
    }
    
    // Reject obvious non-answers
    const nonAnswers = [
      /^(what|how|where|when|why|who)\b/,
      /^(uh|um|er|ah)$/,
      /^(sorry|excuse me)/,
      /^(i don't know|not sure)$/
    ];
    
    for (const pattern of nonAnswers) {
      if (pattern.test(cleaned)) {
        console.log(`🚫 Rejected non-answer pattern: "${cleaned}"`);
        return false;
      }
    }
    
    console.log(`✅ Valid answer: "${cleaned}"`);
    return true;
  }

  // ENHANCED: Mark scheduling as started with additional protection
  markSchedulingStarted(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    // ANTI-LOOP: Prevent scheduling from starting multiple times
    if (session.progress.schedulingStarted) {
      console.log(`🚫 ANTI-LOOP: Scheduling already started for ${callId}`);
      return false;
    }

    session.progress.schedulingStarted = true;
    session.progress.conversationPhase = 'scheduling';
    session.progress.waitingForAnswer = false; // Clear any pending answer wait
    
    console.log(`🗓️ MARKED scheduling started for ${callId} (${session.progress.questionsCompleted}/6 questions complete)`);
    this.updateSessionActivity(callId);
    return true;
  }

  // Get next unanswered question with anti-loop protection
  getNextUnansweredQuestion(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return null;

    // Don't provide questions if scheduling started
    if (session.progress.schedulingStarted) {
      console.log('🚫 Scheduling started, no more questions');
      return null;
    }

    // Don't provide questions if all complete
    if (session.progress.allQuestionsCompleted) {
      console.log('🚫 All questions complete, no more questions');
      return null;
    }

    return session.questions.find(q => !q.answered);
  }

  // Get discovery progress
  getProgress(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return null;

    return {
      questionsCompleted: session.progress.questionsCompleted,
      allQuestionsCompleted: session.progress.allQuestionsCompleted,
      schedulingStarted: session.progress.schedulingStarted,
      waitingForAnswer: session.progress.waitingForAnswer,
      conversationPhase: session.progress.conversationPhase,
      currentQuestionIndex: session.progress.currentQuestionIndex,
      greetingCompleted: session.progress.greetingCompleted
    };
  }

  // Mark greeting as completed
  markGreetingCompleted(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    session.progress.greetingCompleted = true;
    session.progress.conversationPhase = 'discovery';
    
    console.log(`👋 MARKED greeting completed for ${callId}`);
    this.updateSessionActivity(callId);
    return true;
  }

  // Get final discovery data
  getFinalDiscoveryData(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return {};

    const finalData = { ...session.discoveryData };
    
    // Add customer data
    if (session.customerData.email) finalData.customer_email = session.customerData.email;
    if (session.customerData.name) finalData.customer_name = session.customerData.name;
    if (session.customerData.phone) finalData.customer_phone = session.customerData.phone;
    
    return finalData;
  }

  // ENHANCED: Check if user message is scheduling request with better detection
  isSchedulingRequest(userMessage, questionsCompleted) {
    const schedulingKeywords = [
      'schedule', 'book', 'appointment', 'call', 'talk', 'meet',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'tomorrow', 'today', 'next week', 'am', 'pm', 'morning', 'afternoon', 'evening',
      'available', 'times', 'slots', 'when', 'what times'
    ];
    
    const userLower = userMessage.toLowerCase();
    const hasSchedulingKeyword = schedulingKeywords.some(keyword => 
      userLower.includes(keyword)
    );
    
    // Enhanced logic: Allow scheduling if 4+ questions completed OR explicit scheduling request
    const isExplicitScheduling = userLower.includes('schedule') || userLower.includes('book') || 
                                userLower.includes('appointment') || userLower.includes('available');
    
    return hasSchedulingKeyword && (questionsCompleted >= 4 || isExplicitScheduling);
  }

  // Cleanup session
  cleanupSession(callId) {
    if (this.sessionTimeouts.has(callId)) {
      clearTimeout(this.sessionTimeouts.get(callId));
      this.sessionTimeouts.delete(callId);
    }
    
    if (this.activeSessions.has(callId)) {
      console.log(`🧹 Cleaning up session: ${callId}`);
      this.activeSessions.delete(callId);
    }
  }

  // Get session info for debugging
  getSessionInfo(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return null;

    return {
      callId: session.callId,
      questionsCompleted: session.progress.questionsCompleted,
      allQuestionsCompleted: session.progress.allQuestionsCompleted,
      schedulingStarted: session.progress.schedulingStarted,
      conversationPhase: session.progress.conversationPhase,
      greetingCompleted: session.progress.greetingCompleted,
      waitingForAnswer: session.progress.waitingForAnswer,
      currentQuestionIndex: session.progress.currentQuestionIndex,
      customerData: session.customerData,
      questions: session.questions.map(q => ({
        question: q.question,
        asked: q.asked,
        answered: q.answered,
        answer: q.answer || '',
        askedAt: q.askedAt
      })),
      sessionAge: Date.now() - session.createdAt,
      lastActivity: Date.now() - session.lastActivity,
      antiLoop: session.antiLoop
    };
  }

  // Get all active sessions (for debugging)
  getAllSessions() {
    const sessions = [];
    for (const [callId, session] of this.activeSessions) {
      sessions.push({
        callId,
        questionsCompleted: session.progress.questionsCompleted,
        schedulingStarted: session.progress.schedulingStarted,
        conversationPhase: session.progress.conversationPhase,
        customerEmail: session.customerData.email,
        age: Date.now() - session.createdAt,
        antiLoopStats: {
          questionAskedCount: session.antiLoop.questionAskedCount,
          answerCaptureCount: session.antiLoop.answerCaptureCount
        }
      });
    }
    return sessions;
  }

  // Force transition to scheduling (for debugging)
  forceSchedulingTransition(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    session.progress.schedulingStarted = true;
    session.progress.conversationPhase = 'scheduling';
    session.progress.allQuestionsCompleted = true;
    session.progress.waitingForAnswer = false;
    
    console.log(`🔧 FORCED scheduling transition for ${callId}`);
    return true;
  }

  // Reset anti-loop counters (for debugging)
  resetAntiLoopCounters(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    session.antiLoop.questionAskedCount = 0;
    session.antiLoop.lastQuestionAskedAt = 0;
    session.antiLoop.answerCaptureCount = 0;
    session.antiLoop.lastAnswerCapturedAt = 0;
    
    console.log(`🔧 RESET anti-loop counters for ${callId}`);
    return true;
  }

  // Periodic cleanup of old sessions and counters
  performPeriodicCleanup() {
    const now = Date.now();
    let cleanedSessions = 0;
    
    for (const [callId, session] of this.activeSessions) {
      // Clean up very old sessions (over 2 hours)
      const sessionAge = now - session.createdAt;
      if (sessionAge > 2 * 60 * 60 * 1000) { // 2 hours
        this.cleanupSession(callId);
        cleanedSessions++;
      } else {
        // Reset anti-loop counters if they're old
        const oneMinuteAgo = now - 60000;
        if (session.antiLoop.lastQuestionAskedAt < oneMinuteAgo) {
          session.antiLoop.questionAskedCount = 0;
        }
        if (session.antiLoop.lastAnswerCapturedAt < oneMinuteAgo) {
          session.antiLoop.answerCaptureCount = 0;
        }
      }
    }
    
    if (cleanedSessions > 0) {
      console.log(`🧹 Periodic cleanup: removed ${cleanedSessions} old sessions`);
    }
  }
}

// Create global singleton instance
const globalDiscoveryManager = new GlobalDiscoveryManager();

// Run periodic cleanup every 5 minutes
setInterval(() => {
  globalDiscoveryManager.performPeriodicCleanup();
}, 5 * 60 * 1000);

module.exports = globalDiscoveryManager;
