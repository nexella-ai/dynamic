// src/services/discovery/GlobalDiscoveryManager.js - PERSISTENT MEMORY SOLUTION
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
    console.log('🚨 GET SESSION CALLED');
    console.log('🚨 Call ID:', callId);
    console.log('🚨 Customer Data:', customerData);
    console.log('🚨 Current active sessions count:', this.activeSessions.size);
    console.log('🚨 Active session IDs:', Array.from(this.activeSessions.keys()));

    if (!callId) {
      console.warn('⚠️ No callId provided to getSession');
      return this.createNewSession('temp_' + Date.now(), customerData);
    }

    // Check if session exists
    if (this.activeSessions.has(callId)) {
      const session = this.activeSessions.get(callId);
      console.log(`🚨 🔄 RETRIEVED EXISTING SESSION for ${callId}:`);
      console.log('   📊 Questions Completed:', session.progress.questionsCompleted);
      console.log('   🗓️ Scheduling Started:', session.progress.schedulingStarted);
      console.log('   📝 Conversation Phase:', session.progress.conversationPhase);
      
      // Refresh timeout
      this.refreshSessionTimeout(callId);
      return session;
    }

    // Create new session
    console.log(`🚨 🆕 CREATING NEW SESSION for ${callId}`);
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
        { question: 'How did you hear about us?', field: 'How did you hear about us', asked: false, answered: false, answer: '' },
        { question: 'What industry or business are you in?', field: 'Business/Industry', asked: false, answered: false, answer: '' },
        { question: 'What\'s your main product or service?', field: 'Main product', asked: false, answered: false, answer: '' },
        { question: 'Are you currently running any ads?', field: 'Running ads', asked: false, answered: false, answer: '' },
        { question: 'Are you using any CRM system?', field: 'Using CRM', asked: false, answered: false, answer: '' },
        { question: 'What are your biggest pain points or challenges?', field: 'Pain points', asked: false, answered: false, answer: '' }
      ],
      progress: {
        currentQuestionIndex: -1,
        questionsCompleted: 0,
        allQuestionsCompleted: false,
        waitingForAnswer: false,
        schedulingStarted: false,
        lastQuestionAsked: null,
        conversationPhase: 'greeting' // greeting -> discovery -> scheduling -> completed
      },
      userResponseBuffer: [],
      isCapturingAnswer: false,
      discoveryData: {},
      lastBotMessageTimestamp: 0
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

  // Mark question as asked
  markQuestionAsked(callId, questionIndex, botMessage) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    if (questionIndex >= 0 && questionIndex < session.questions.length) {
      const question = session.questions[questionIndex];
      question.asked = true;
      session.progress.currentQuestionIndex = questionIndex;
      session.progress.waitingForAnswer = true;
      session.progress.lastQuestionAsked = question.question;
      session.lastBotMessageTimestamp = Date.now();
      
      console.log(`✅ Marked Q${questionIndex + 1} as asked for ${callId}: "${question.question}"`);
      this.updateSessionActivity(callId);
      return true;
    }
    return false;
  }

  // Capture user answer
  captureAnswer(callId, questionIndex, answer) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    if (questionIndex >= 0 && questionIndex < session.questions.length) {
      const question = session.questions[questionIndex];
      question.answered = true;
      question.answer = answer;
      
      session.discoveryData[question.field] = answer;
      session.discoveryData[`question_${questionIndex}`] = answer;
      
      session.progress.questionsCompleted++;
      session.progress.waitingForAnswer = false;
      session.progress.allQuestionsCompleted = session.questions.every(q => q.answered);
      
      console.log(`✅ Captured answer for ${callId} Q${questionIndex + 1}: "${answer}"`);
      console.log(`📊 Progress: ${session.progress.questionsCompleted}/6 questions completed`);
      
      this.updateSessionActivity(callId);
      return true;
    }
    return false;
  }

  // Mark scheduling as started
  markSchedulingStarted(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    session.progress.schedulingStarted = true;
    session.progress.conversationPhase = 'scheduling';
    
    console.log(`🗓️ Marked scheduling started for ${callId}`);
    this.updateSessionActivity(callId);
    return true;
  }

  // Get next unanswered question
  getNextUnansweredQuestion(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return null;

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
      currentQuestionIndex: session.progress.currentQuestionIndex
    };
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

  // Check if user message is scheduling request
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
    
    // Allow scheduling if 4+ questions completed
    return hasSchedulingKeyword && questionsCompleted >= 4;
  }

  // Detect if bot message contains a discovery question
  detectQuestionInBotMessage(callId, botMessage) {
    const session = this.activeSessions.get(callId);
    if (!session) return false;

    // Don't detect if scheduling started
    if (session.progress.schedulingStarted) {
      console.log('🚫 Scheduling started - ignoring question detection');
      return false;
    }

    // Don't detect if all questions complete
    if (session.progress.allQuestionsCompleted) {
      console.log('🚫 All questions complete - ignoring question detection');
      return false;
    }

    const botContent = botMessage.toLowerCase();
    
    // Don't detect scheduling responses as questions
    const schedulingIndicators = [
      'available', 'times', 'slots', 'calendar', 'schedule', 'appointment',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
      'am', 'pm', 'morning', 'afternoon', 'evening'
    ];
    
    const hasSchedulingContent = schedulingIndicators.some(indicator => 
      botContent.includes(indicator)
    );
    
    if (hasSchedulingContent) {
      console.log('🚫 Bot message contains scheduling content - not a discovery question');
      return false;
    }

    const nextQuestionIndex = session.questions.findIndex(q => !q.asked);
    if (nextQuestionIndex === -1) return false;

    if (session.progress.waitingForAnswer) {
      console.log(`⚠️ Already waiting for answer - ignoring detection`);
      return false;
    }

    // Specific detection patterns
    let detected = false;
    switch (nextQuestionIndex) {
      case 0: // How did you hear about us?
        detected = (botContent.includes('hear about') && botContent.includes('us')) && 
                  !botContent.includes('schedule') && !botContent.includes('available');
        break;
      case 1: // What industry or business are you in?
        detected = ((botContent.includes('industry') || 
                   (botContent.includes('business') && botContent.includes('in'))) && 
                   !botContent.includes('hear about') && !botContent.includes('available'));
        break;
      case 2: // What's your main product or service?
        detected = ((botContent.includes('product') || botContent.includes('service')) && 
                   (botContent.includes('main') || botContent.includes('your'))) && 
                   !botContent.includes('industry') && !botContent.includes('available');
        break;
      case 3: // Are you currently running any ads?
        detected = (botContent.includes('running') && botContent.includes('ads')) && 
                  !botContent.includes('available');
        break;
      case 4: // Are you using any CRM system?
        detected = (botContent.includes('crm') || 
                  (botContent.includes('using') && botContent.includes('system'))) &&
                  !botContent.includes('available');
        break;
      case 5: // What are your biggest pain points or challenges?
        detected = (botContent.includes('pain point') || botContent.includes('challenge')) && 
                  (botContent.includes('biggest') || botContent.includes('main')) &&
                  !botContent.includes('available');
        break;
    }

    if (detected) {
      this.markQuestionAsked(callId, nextQuestionIndex, botMessage);
      return true;
    }

    return false;
  }

  // Generate context prompt for AI
  generateContextPrompt(callId) {
    const session = this.activeSessions.get(callId);
    if (!session) return '';

    // Don't generate discovery prompts if scheduling started
    if (session.progress.schedulingStarted) {
      console.log('🚫 Scheduling started - no discovery prompts');
      return '';
    }

    if (!session.progress.allQuestionsCompleted) {
      const nextUnanswered = session.questions.find(q => !q.answered);
      if (nextUnanswered) {
        const questionNumber = session.questions.indexOf(nextUnanswered) + 1;
        const completed = session.questions
          .filter(q => q.answered)
          .map((q, i) => `${session.questions.indexOf(q) + 1}. ${q.question} ✓`)
          .join('\n');

        return `

DISCOVERY STATUS (${session.progress.questionsCompleted}/6 COMPLETE):
${completed || 'None yet'}

NEXT QUESTION TO ASK:
${questionNumber}. ${nextUnanswered.question}

CRITICAL RULES:
- Ask question ${questionNumber} EXACTLY as written above
- Ask ONLY this one question, nothing else
- Wait for user's complete answer before proceeding
- Do NOT skip to scheduling
- If user asks about scheduling/times, say: "Let me finish getting some information first, then we'll find you a perfect time."

KEEP IT SHORT AND FOCUSED.`;
      }
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
      questions: session.questions.map(q => ({
        question: q.question,
        asked: q.asked,
        answered: q.answered,
        answer: q.answer || ''
      })),
      sessionAge: Date.now() - session.createdAt,
      lastActivity: Date.now() - session.lastActivity
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
        age: Date.now() - session.createdAt
      });
    }
    return sessions;
  }
}

// Create global singleton instance
const globalDiscoveryManager = new GlobalDiscoveryManager();

module.exports = globalDiscoveryManager;
