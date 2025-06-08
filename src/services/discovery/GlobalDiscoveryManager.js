// src/services/discovery/GlobalDiscoveryManager.js - FIXED ANTI-LOOP VERSION
class GlobalDiscoveryManager {
  constructor() {
    // Global storage for all active discovery sessions
    this.activeSessions = new Map(); // callId -> discoveryState
    this.sessionTimeouts = new Map(); // callId -> timeout
    
    // Session expires after 30 minutes of inactivity
    this.SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    
    console.log('🧠 GlobalDiscoveryManager initialized with anti-loop protection');
  }

  // Get or create discovery session for a call
  getSession(callId, customerData = {}) {
    console.log('📞 GET SESSION CALLED');
    console.log('🆔 Call ID:', callId);
    console.log('👤 Customer Data:', customerData);
    console.log('📊 Current active sessions count:', this.activeSessions.size);

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
        email: customerData.email || '',
        name: customerData.name || '',
        phone: customerData.phone || ''
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
        preventRepeatedQuestions: true
      }
    };

    this.activeSessions.set(callId, session);
    this.refreshSessionTimeout(callId);
    
    console.log(`✅ Created session for ${callId}`);
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

  // FIXED: Anti-loop question asking
  markQuestionAsked(callId, questionIndex, botMessage) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    // ANTI-LOOP: Check if already asked recently
    const now = Date.now();
    if (session.antiLoop.lastQuestionAskedAt > 0) {
      const timeSinceLastQuestion = now - session.antiLoop.lastQuestionAskedAt;
      if (timeSinceLastQuestion < 5000) { // 5 seconds cooldown
        console.log(`🚫 ANTI-LOOP: Question asked too recently (${timeSinceLastQuestion}ms ago)`);
        return false;
      }
    }

    // ANTI-LOOP: Check question rate limiting
    session.antiLoop.questionAskedCount++;
    const minuteAgo = now - 60000;
    if (session.antiLoop.questionAskedCount > session.antiLoop.maxQuestionsPerMinute) {
      console.log(`🚫 ANTI-LOOP: Too many questions asked (${session.antiLoop.questionAskedCount} in last minute)`);
      return false;
    }

    if (questionIndex >= 0 && questionIndex < session.questions.length) {
      const question = session.questions[questionIndex];
      
      // ANTI-LOOP: Check if question already asked
      if (question.asked && session.antiLoop.preventRepeatedQuestions) {
        console.log(`🚫 ANTI-LOOP: Question ${questionIndex + 1} already asked`);
        return false;
      }
      
      question.asked = true;
      question.askedAt = now;
      session.progress.currentQuestionIndex = questionIndex;
      session.progress.waitingForAnswer = true;
      session.progress.lastQuestionAsked = question.question;
      session.lastBotMessageTimestamp = now;
      session.antiLoop.lastQuestionAskedAt = now;
      
      console.log(`✅ MARKED Q${questionIndex + 1} as asked for ${callId}: "${question.question}"`);
      this.updateSessionActivity(callId);
      return true;
    }
    return false;
  }

  // FIXED: Safer answer capture
  captureAnswer(callId, questionIndex, answer) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    // ANTI-LOOP: Validate answer capture
    if (questionIndex < 0 || questionIndex >= session.questions.length) {
      console.log(`🚫 ANTI-LOOP: Invalid question index ${questionIndex}`);
      return false;
    }

    const question = session.questions[questionIndex];
    
    // ANTI-LOOP: Check if already answered
    if (question.answered) {
      console.log(`🚫 ANTI-LOOP: Question ${questionIndex + 1} already answered`);
      return false;
    }

    // ANTI-LOOP: Validate answer quality
    if (!this.isValidAnswer(answer)) {
      console.log(`🚫 ANTI-LOOP: Invalid answer rejected: "${answer}"`);
      return false;
    }

    question.answered = true;
    question.answer = answer.trim();
    
    session.discoveryData[question.field] = answer.trim();
    session.discoveryData[`question_${questionIndex}`] = answer.trim();
    
    session.progress.questionsCompleted++;
    session.progress.waitingForAnswer = false;
    session.progress.allQuestionsCompleted = session.questions.every(q => q.answered);
    
    // ANTI-LOOP: Auto-transition to scheduling if all done
    if (session.progress.allQuestionsCompleted && !session.progress.schedulingStarted) {
      console.log('🎉 ALL QUESTIONS COMPLETE - AUTO-TRANSITIONING TO SCHEDULING');
      session.progress.schedulingStarted = true;
      session.progress.conversationPhase = 'scheduling';
    }
    
    console.log(`✅ CAPTURED answer for ${callId} Q${questionIndex + 1}: "${answer}"`);
    console.log(`📊 Progress: ${session.progress.questionsCompleted}/6 questions completed`);
    
    this.updateSessionActivity(callId);
    return true;
  }

  // IMPROVED: Answer validation
  isValidAnswer(answer) {
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
        return false;
      }
    }
    
    // Reject obvious non-answers
    const nonAnswers = [
      /^(what|how|where|when|why|who)\b/,
      /^(uh|um|er|ah|okay|ok)$/,
      /^(yes|no)$/,
      /^(sorry|excuse me)/
    ];
    
    for (const pattern of nonAnswers) {
      if (pattern.test(cleaned)) {
        return false;
      }
    }
    
    return true;
  }

  // FIXED: Mark scheduling as started with protection
  markSchedulingStarted(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    // ANTI-LOOP: Only allow if questions are complete or mostly complete
    if (session.progress.questionsCompleted < 4) {
      console.log(`🚫 ANTI-LOOP: Cannot start scheduling with only ${session.progress.questionsCompleted} questions completed`);
      return false;
    }

    session.progress.schedulingStarted = true;
    session.progress.conversationPhase = 'scheduling';
    
    console.log(`🗓️ MARKED scheduling started for ${callId} (${session.progress.questionsCompleted}/6 questions complete)`);
    this.updateSessionActivity(callId);
    return true;
  }

  // Get next unanswered question with anti-loop protection
  getNextUnansweredQuestion(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return null;

    // ANTI-LOOP: Don't provide questions if scheduling started
    if (session.progress.schedulingStarted) {
      console.log('🚫 ANTI-LOOP: Scheduling started, no more questions');
      return null;
    }

    // ANTI-LOOP: Don't provide questions if all complete
    if (session.progress.allQuestionsCompleted) {
      console.log('🚫 ANTI-LOOP: All questions complete, no more questions');
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

  // IMPROVED: Scheduling request detection
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
    
    // Allow scheduling if 4+ questions completed OR explicit scheduling request
    return hasSchedulingKeyword && questionsCompleted >= 4;
  }

  // FIXED: Question detection with better anti-loop
  detectQuestionInBotMessage(callId, botMessage) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    // ANTI-LOOP: Strong protection against detection in wrong phases
    if (session.progress.schedulingStarted) {
      console.log('🚫 ANTI-LOOP: Scheduling started - no question detection');
      return false;
    }

    if (session.progress.allQuestionsCompleted) {
      console.log('🚫 ANTI-LOOP: All questions complete - no question detection');
      return false;
    }

    if (session.progress.waitingForAnswer) {
      console.log('🚫 ANTI-LOOP: Already waiting for answer - no new question detection');
      return false;
    }

    const botContent = botMessage.toLowerCase();
    
    // ANTI-LOOP: Don't detect scheduling content as questions
    const schedulingIndicators = [
      'available', 'times', 'slots', 'calendar', 'schedule', 'appointment',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
      'am', 'pm', 'morning', 'afternoon', 'evening', 'day works', 'time works'
    ];
    
    const hasSchedulingContent = schedulingIndicators.some(indicator => 
      botContent.includes(indicator)
    );
    
    if (hasSchedulingContent) {
      console.log('🚫 ANTI-LOOP: Bot message contains scheduling content - not a discovery question');
      return false;
    }

    const nextQuestionIndex = session.questions.findIndex(q => !q.asked && !q.answered);
    if (nextQuestionIndex === -1) {
      console.log('🚫 ANTI-LOOP: No more questions to ask');
      return false;
    }

    // ANTI-LOOP: Rate limiting check
    const now = Date.now();
    if (session.antiLoop.lastQuestionAskedAt > 0) {
      const timeSinceLastQuestion = now - session.antiLoop.lastQuestionAskedAt;
      if (timeSinceLastQuestion < 3000) { // 3 seconds minimum between questions
        console.log(`🚫 ANTI-LOOP: Too soon since last question (${timeSinceLastQuestion}ms)`);
        return false;
      }
    }

    // More flexible detection patterns
    let detected = false;
    switch (nextQuestionIndex) {
      case 0: // How did you hear about us?
        detected = botContent.includes('hear about') || 
                  botContent.includes('how did you find') ||
                  botContent.includes('where did you hear');
        break;
        
      case 1: // What industry or business are you in?
        detected = botContent.includes('industry') || 
                  (botContent.includes('business') && !botContent.includes('hear about')) ||
                  botContent.includes('what field') ||
                  botContent.includes('line of work');
        break;
        
      case 2: // What's your main product or service?
        detected = (botContent.includes('product') || botContent.includes('service')) &&
                  !botContent.includes('industry') &&
                  !botContent.includes('business');
        break;
        
      case 3: // Are you currently running any ads?
        detected = (botContent.includes('running') && botContent.includes('ads')) || 
                  botContent.includes('advertising') ||
                  botContent.includes('marketing campaigns');
        break;
        
      case 4: // Are you using any CRM system?
        detected = botContent.includes('crm') || 
                  (botContent.includes('using') && botContent.includes('system')) ||
                  botContent.includes('customer management');
        break;
        
      case 5: // What are your biggest pain points or challenges?
        detected = botContent.includes('pain point') || 
                  botContent.includes('challenge') || 
                  botContent.includes('biggest') ||
                  botContent.includes('struggle') ||
                  botContent.includes('difficult');
        break;
    }

    console.log(`🔍 Question ${nextQuestionIndex + 1} detection - Content: "${botContent.substring(0, 50)}..." - Detected: ${detected}`);

    if (detected) {
      return this.markQuestionAsked(callId, nextQuestionIndex, botMessage);
    }

    return false;
  }

  // ANTI-LOOP: Generate context prompt with strict phase control
  generateContextPrompt(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return '';

    // ANTI-LOOP: Strict phase-based prompting
    if (session.progress.schedulingStarted) {
      console.log('🚫 ANTI-LOOP: Scheduling started - no discovery prompts');
      return `

SCHEDULING PHASE ACTIVE:
- All discovery questions are complete (${session.progress.questionsCompleted}/6)
- Focus ONLY on scheduling and booking
- Ask about preferred days/times
- When user gives specific time, confirm booking immediately
- Do NOT ask any more discovery questions

CRITICAL: You are now in SCHEDULING mode only.`;
    }

    if (session.progress.allQuestionsCompleted) {
      console.log('🚫 ANTI-LOOP: All questions complete - transition to scheduling');
      return `

DISCOVERY COMPLETE - TRANSITION TO SCHEDULING:
- All 6 discovery questions have been answered
- Say: "Perfect! I have all the information I need. Let's find you a time that works. What day works best for you?"
- Do NOT ask any more discovery questions
- Focus ONLY on scheduling from now on

CRITICAL: Transition to scheduling phase immediately.`;
    }

    if (!session.progress.greetingCompleted) {
      return `

GREETING PHASE:
- Wait for user to respond to greeting
- After they respond, acknowledge and ask first discovery question
- Do NOT ask multiple questions at once

Current phase: Greeting`;
    }

    // Discovery phase prompting
    const nextUnanswered = session.questions.find(q => !q.answered);
    if (nextUnanswered) {
      const questionNumber = session.questions.indexOf(nextUnanswered) + 1;
      const completed = session.questions
        .filter(q => q.answered)
        .map((q, i) => `${session.questions.indexOf(q) + 1}. ${q.question} ✓`)
        .join('\n');

      return `

DISCOVERY PHASE (${session.progress.questionsCompleted}/6 COMPLETE):
Completed Questions:
${completed || 'None yet'}

NEXT QUESTION TO ASK:
${questionNumber}. ${nextUnanswered.question}

CRITICAL ANTI-LOOP RULES:
- Ask question ${questionNumber} EXACTLY as written above
- Ask ONLY this one question, nothing else
- Wait for user's complete answer before proceeding
- Do NOT repeat questions that have been answered
- Do NOT skip to scheduling until all 6 questions are done
- If user asks about scheduling/times, say: "Let me finish getting some information first, then we'll find you a perfect time."

Current phase: Discovery (Question ${questionNumber})`;
    }

    return '';
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
        age: Date.now() - session.createdAt
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
    
    console.log(`🔧 FORCED scheduling transition for ${callId}`);
    return true;
  }

  // Reset anti-loop counters (for debugging)
  resetAntiLoopCounters(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    session.antiLoop.questionAskedCount = 0;
    session.antiLoop.lastQuestionAskedAt = 0;
    
    console.log(`🔧 RESET anti-loop counters for ${callId}`);
    return true;
  }
}

// Create global singleton instance
const globalDiscoveryManager = new GlobalDiscoveryManager();

module.exports = globalDiscoveryManager;
