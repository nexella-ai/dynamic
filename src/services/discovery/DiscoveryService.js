// src/services/discovery/DiscoveryService.js - CLEAN FIXED VERSION
class DiscoveryService {
  constructor() {
    this.questions = [
      { question: 'How did you hear about us?', field: 'How did you hear about us', asked: false, answered: false, answer: '' },
      { question: 'What industry or business are you in?', field: 'Business/Industry', asked: false, answered: false, answer: '' },
      { question: 'What\'s your main product or service?', field: 'Main product', asked: false, answered: false, answer: '' },
      { question: 'Are you currently running any ads?', field: 'Running ads', asked: false, answered: false, answer: '' },
      { question: 'Are you using any CRM system?', field: 'Using CRM', asked: false, answered: false, answer: '' },
      { question: 'What are your biggest pain points or challenges?', field: 'Pain points', asked: false, answered: false, answer: '' }
    ];
    
    this.progress = {
      currentQuestionIndex: -1,
      questionsCompleted: 0,
      allQuestionsCompleted: false,
      waitingForAnswer: false,
      schedulingStarted: false,
      lastQuestionAsked: null
    };
    
    this.userResponseBuffer = [];
    this.isCapturingAnswer = false;
    this.answerCaptureTimer = null;
    this.discoveryData = {};
    this.lastBotMessageTimestamp = 0;
  }

  // Reset discovery state for new conversation
  reset() {
    this.questions.forEach(q => {
      q.asked = false;
      q.answered = false;
      q.answer = '';
    });
    
    this.progress = {
      currentQuestionIndex: -1,
      questionsCompleted: 0,
      allQuestionsCompleted: false,
      waitingForAnswer: false,
      schedulingStarted: false,
      lastQuestionAsked: null
    };
    
    this.userResponseBuffer = [];
    this.isCapturingAnswer = false;
    this.discoveryData = {};
    
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
      this.answerCaptureTimer = null;
    }
  }

  // Get contextual acknowledgment based on user's answer
  getContextualAcknowledgment(userAnswer, questionIndex) {
    const answer = userAnswer.toLowerCase();
    
    switch (questionIndex) {
      case 0: // How did you hear about us?
        if (answer.includes('instagram') || answer.includes('social media')) {
          return "Instagram, nice! Social media is huge these days.";
        } else if (answer.includes('google') || answer.includes('search')) {
          return "Found us through Google, perfect.";
        } else if (answer.includes('referral') || answer.includes('friend') || answer.includes('recommend')) {
          return "Word of mouth referrals are the best!";
        } else {
          return "Great, thanks for sharing that.";
        }
        
      case 1: // Industry/Business
        if (answer.includes('solar')) {
          return "Solar industry, that's awesome! Clean energy is the future.";
        } else if (answer.includes('real estate') || answer.includes('property')) {
          return "Real estate, excellent! That's a great market.";
        } else if (answer.includes('healthcare') || answer.includes('medical')) {
          return "Healthcare, wonderful! Such important work.";
        } else if (answer.includes('restaurant') || answer.includes('food')) {
          return "Food industry, nice! Everyone loves good food.";
        } else if (answer.includes('fitness') || answer.includes('gym')) {
          return "Fitness industry, fantastic! Health is so important.";
        } else if (answer.includes('e-commerce') || answer.includes('online')) {
          return "E-commerce, perfect! Online business is booming.";
        } else {
          return `The ${answer.split(' ')[0]} industry, that's great.`;
        }
        
      case 2: // Main product/service
        if (answer.includes('solar')) {
          return "Solar installations, excellent choice for the market.";
        } else if (answer.includes('coaching') || answer.includes('consulting')) {
          return "Coaching services, that's valuable work.";
        } else if (answer.includes('software') || answer.includes('app')) {
          return "Software solutions, perfect for today's market.";
        } else {
          return "Got it, that sounds like a great service.";
        }
        
      case 3: // Running ads
        if (answer.includes('yes') || answer.includes('google') || answer.includes('facebook') || answer.includes('meta')) {
          return "Great, so you're already running ads. That's smart.";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "No ads currently, that's totally fine.";
        } else {
          return "Got it, thanks for that info.";
        }
        
      case 4: // Using CRM
        if (answer.includes('gohighlevel') || answer.includes('go high level')) {
          return "GoHighLevel, excellent choice! That's a powerful platform.";
        } else if (answer.includes('hubspot')) {
          return "HubSpot, nice! That's a solid CRM.";
        } else if (answer.includes('salesforce')) {
          return "Salesforce, perfect! The industry standard.";
        } else if (answer.includes('yes')) {
          return "Great, having a CRM system is really important.";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "No CRM currently, that's actually pretty common.";
        } else {
          return "Perfect, I understand.";
        }
        
      case 5: // Pain points
        if (answer.includes('lead') || answer.includes('follow up')) {
          return "Lead follow-up challenges, I totally get that.";
        } else if (answer.includes('time') || answer.includes('busy')) {
          return "Time management issues, that's so common in business.";
        } else if (answer.includes('money') || answer.includes('expensive')) {
          return "Budget concerns, completely understandable.";
        } else if (answer.includes('appointment') || answer.includes('booking')) {
          return "Getting more appointments, that's a common challenge.";
        } else {
          return "I see, those are definitely real challenges.";
        }
        
      default:
        const acknowledgments = [
          "Perfect, thank you.",
          "Got it, that's helpful.",
          "Great, I understand.",
          "Excellent, thank you.",
          "That makes sense.",
          "Wonderful, thanks.",
          "I see, that's very helpful.",
          "Perfect, understood.",
          "Awesome, got it."
        ];
        return acknowledgments[questionIndex % acknowledgments.length];
    }
  }

  // FIXED: Much more precise question detection
  detectQuestionAsked(botMessage) {
    const botContent = botMessage.toLowerCase();
    
    // CRITICAL FIX: Don't detect questions if scheduling has started
    if (this.progress.schedulingStarted) {
      console.log('🚫 Scheduling started - ignoring question detection');
      return false;
    }
    
    // CRITICAL FIX: Don't detect if all questions are complete
    if (this.progress.allQuestionsCompleted) {
      console.log('🚫 All questions complete - ignoring question detection');
      return false;
    }
    
    // CRITICAL FIX: Don't detect scheduling responses as questions
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
    
    const nextQuestionIndex = this.questions.findIndex(q => !q.asked);
    
    if (nextQuestionIndex === -1) {
      console.log('✅ All questions have been asked');
      return false;
    }
    
    if (this.progress.waitingForAnswer) {
      console.log(`⚠️ Already waiting for answer to question ${this.progress.currentQuestionIndex + 1} - ignoring detection`);
      return false;
    }
    
    const nextQuestion = this.questions[nextQuestionIndex];
    let detected = false;
    
    // MUCH MORE SPECIFIC detection patterns
    switch (nextQuestionIndex) {
      case 0: // How did you hear about us?
        detected = (botContent.includes('hear about') && botContent.includes('us')) && 
                  !botContent.includes('schedule') && 
                  !botContent.includes('available') &&
                  !botContent.includes('times');
        break;
        
      case 1: // What industry or business are you in?
        detected = ((botContent.includes('industry') || 
                   (botContent.includes('business') && botContent.includes('in'))) && 
                   !botContent.includes('hear about') &&
                   !botContent.includes('schedule') &&
                   !botContent.includes('available'));
        break;
        
      case 2: // What's your main product or service?
        detected = ((botContent.includes('product') || botContent.includes('service')) && 
                   (botContent.includes('main') || botContent.includes('your'))) && 
                   !botContent.includes('industry') && 
                   !botContent.includes('business') &&
                   !botContent.includes('available') &&
                   !botContent.includes('schedule');
        break;
        
      case 3: // Are you currently running any ads?
        detected = (botContent.includes('running') && botContent.includes('ads')) && 
                  !botContent.includes('available') &&
                  !botContent.includes('schedule');
        break;
        
      case 4: // Are you using any CRM system?
        detected = (botContent.includes('crm') || 
                  (botContent.includes('using') && botContent.includes('system'))) &&
                  !botContent.includes('available') &&
                  !botContent.includes('schedule');
        break;
        
      case 5: // What are your biggest pain points or challenges?
        detected = (botContent.includes('pain point') || botContent.includes('challenge')) && 
                  (botContent.includes('biggest') || botContent.includes('main')) &&
                  !botContent.includes('available') &&
                  !botContent.includes('schedule');
        break;
    }
    
    if (detected) {
      console.log(`✅ DETECTED Question ${nextQuestionIndex + 1}: "${nextQuestion.question}"`);
      console.log(`🎯 Question content that triggered detection: "${botContent}"`);
      
      nextQuestion.asked = true;
      this.progress.currentQuestionIndex = nextQuestionIndex;
      this.progress.waitingForAnswer = true;
      this.progress.lastQuestionAsked = nextQuestion.question;
      this.userResponseBuffer = [];
      this.lastBotMessageTimestamp = Date.now();
      return true;
    }
    
    return false;
  }

  // FIXED: Better answer capture with scheduling detection
  captureUserAnswer(userMessage) {
    if (!this.progress.waitingForAnswer || this.isCapturingAnswer) {
      return;
    }
    
    const currentQ = this.questions[this.progress.currentQuestionIndex];
    if (!currentQ || currentQ.answered) {
      return;
    }
    
    // CRITICAL FIX: Strong scheduling detection
    const schedulingKeywords = [
      'schedule', 'book', 'appointment', 'call', 'talk', 'meet',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'tomorrow', 'today', 'next week', 'am', 'pm', 'morning', 'afternoon', 'evening',
      'available', 'times', 'slots', 'when'
    ];
    
    const userLower = userMessage.toLowerCase();
    const isSchedulingRequest = schedulingKeywords.some(keyword => 
      userLower.includes(keyword)
    );
    
    // CRITICAL FIX: If 4+ questions done and user asks about scheduling, don't capture as answer
    if (isSchedulingRequest && this.progress.questionsCompleted >= 4) {
      console.log(`🗓️ User requesting scheduling with ${this.progress.questionsCompleted}/6 questions done - not capturing as discovery answer`);
      console.log(`📝 Scheduling request: "${userMessage}"`);
      return;
    }
    
    // CRITICAL FIX: Also check for obvious availability questions
    const availabilityQuestions = [
      'what times', 'when are you', 'when do you', 'what days', 'available'
    ];
    
    const isAvailabilityQuestion = availabilityQuestions.some(phrase => 
      userLower.includes(phrase)
    );
    
    if (isAvailabilityQuestion) {
      console.log(`❓ User asking about availability - not capturing as discovery answer: "${userMessage}"`);
      return;
    }
    
    console.log(`📝 Buffering answer for Q${this.progress.currentQuestionIndex + 1}: "${userMessage}"`);
    console.log(`🎯 This is for question: "${currentQ.question}"`);
    
    this.userResponseBuffer.push(userMessage.trim());
    
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
    }
    
    // Shorter timer for faster response
    this.answerCaptureTimer = setTimeout(() => {
      if (this.isCapturingAnswer) return;
      
      this.isCapturingAnswer = true;
      
      const completeAnswer = this.userResponseBuffer.join(' ');
      
      // Validate answer makes sense for the question
      if (this.isValidAnswerForQuestion(completeAnswer, this.progress.currentQuestionIndex)) {
        currentQ.answered = true;
        currentQ.answer = completeAnswer;
        this.discoveryData[currentQ.field] = completeAnswer;
        this.discoveryData[`question_${this.progress.currentQuestionIndex}`] = completeAnswer;
        
        this.progress.questionsCompleted++;
        this.progress.waitingForAnswer = false;
        this.progress.allQuestionsCompleted = this.questions.every(q => q.answered);
        
        console.log(`✅ CAPTURED Q${this.progress.currentQuestionIndex + 1}: "${completeAnswer}"`);
        console.log(`📊 Progress: ${this.progress.questionsCompleted}/6 questions completed`);
        
        // CRITICAL FIX: Auto-transition to scheduling if all questions done
        if (this.progress.allQuestionsCompleted) {
          console.log('🎉 ALL DISCOVERY QUESTIONS COMPLETED - Ready for scheduling');
        }
      } else {
        console.log(`⚠️ Answer doesn't seem to match question ${this.progress.currentQuestionIndex + 1}, waiting for better answer`);
      }
      
      this.userResponseBuffer = [];
      this.isCapturingAnswer = false;
      this.answerCaptureTimer = null;
      
    }, 1500); // Faster capture
  }

  // FIXED: Better validation
  isValidAnswerForQuestion(answer, questionIndex) {
    const answerLower = answer.toLowerCase();
    
    // Block obvious scheduling requests
    const schedulingPhrases = [
      'tuesday at', 'monday at', 'wednesday at', 'thursday at', 'friday at',
      'next week', 'tomorrow at', 'today at', 'available times', 'what times'
    ];
    
    const isSchedulingPhrase = schedulingPhrases.some(phrase => 
      answerLower.includes(phrase)
    );
    
    if (isSchedulingPhrase) {
      console.log(`🚫 Blocking scheduling phrase as discovery answer: "${answer}"`);
      return false;
    }
    
    // Basic length check
    if (answer.trim().length < 2) {
      return false;
    }
    
    return true;
  }

  // FIXED: Context prompt that prevents loops
  generateContextPrompt() {
    // CRITICAL FIX: Don't generate discovery prompts if scheduling started
    if (this.progress.schedulingStarted) {
      console.log('🚫 Scheduling started - no discovery prompts');
      return null;
    }
    
    if (!this.progress.allQuestionsCompleted) {
      const nextUnanswered = this.getNextUnansweredQuestion();
      if (nextUnanswered) {
        const questionNumber = this.questions.indexOf(nextUnanswered) + 1;
        const completed = this.getCompletedQuestionsSummary();
        
        const lastAnsweredQ = this.questions.find(q => q.asked && q.answered && q.answer);
        let acknowledgmentInstruction = '';
        
        if (lastAnsweredQ && this.progress.questionsCompleted > 0) {
          const lastQuestionIndex = this.questions.indexOf(lastAnsweredQ);
          const suggestedAck = this.getContextualAcknowledgment(lastAnsweredQ.answer, lastQuestionIndex);
          acknowledgmentInstruction = `

The user just answered: "${lastAnsweredQ.answer}"
Acknowledge this with: "${suggestedAck}" then ask the next question.`;
        }
        
        return `

DISCOVERY STATUS (${this.progress.questionsCompleted}/6 COMPLETE):
${completed || 'None yet'}

NEXT QUESTION TO ASK:
${questionNumber}. ${nextUnanswered.question}${acknowledgmentInstruction}

CRITICAL RULES:
- Ask question ${questionNumber} EXACTLY as written above
- Ask ONLY this one question, nothing else
- Wait for user's complete answer before proceeding
- Do NOT skip to scheduling
- If user asks about scheduling/times, say: "Let me finish getting some information first, then we'll find you a perfect time."

KEEP IT SHORT AND FOCUSED.`;
      }
    }
    return null;
  }

  // NEW: Method to mark scheduling started (prevents discovery loops)
  markSchedulingStarted() {
    this.progress.schedulingStarted = true;
    console.log('🗓️ SCHEDULING PHASE STARTED - Discovery questions disabled');
  }

  // NEW: Check if we can start scheduling
  canStartScheduling() {
    return this.progress.allQuestionsCompleted && !this.progress.schedulingStarted;
  }

  // Get next unanswered question
  getNextUnansweredQuestion() {
    return this.questions.find(q => !q.answered);
  }

  // Get completed questions summary
  getCompletedQuestionsSummary() {
    return this.questions
      .filter(q => q.answered)
      .map((q, i) => `${this.questions.indexOf(q) + 1}. ${q.question} ✓`)
      .join('\n');
  }

  // Get final discovery data formatted for webhook
  getFinalDiscoveryData() {
    const finalData = {};
    this.questions.forEach((q, index) => {
      if (q.answered && q.answer) {
        finalData[q.field] = q.answer;
        finalData[`question_${index}`] = q.answer;
      }
    });
    return finalData;
  }

  // Capture any buffered answers on connection close
  captureBufferedAnswers() {
    if (this.userResponseBuffer.length > 0 && this.progress.waitingForAnswer) {
      const currentQ = this.questions[this.progress.currentQuestionIndex];
      if (currentQ && !currentQ.answered) {
        const completeAnswer = this.userResponseBuffer.join(' ');
        currentQ.answered = true;
        currentQ.answer = completeAnswer;
        this.discoveryData[currentQ.field] = completeAnswer;
        this.discoveryData[`question_${this.progress.currentQuestionIndex}`] = completeAnswer;
        this.progress.questionsCompleted++;
        console.log(`🔌 Captured buffered answer on close: "${completeAnswer}"`);
      }
    }
  }

  // Cleanup timers
  cleanup() {
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
      this.answerCaptureTimer = null;
      console.log('🧹 Cleared pending answer capture timer');
    }
  }

  // Get discovery system info
  getDiscoveryInfo() {
    return {
      totalQuestions: this.questions.length,
      questionsCompleted: this.progress.questionsCompleted,
      allQuestionsCompleted: this.progress.allQuestionsCompleted,
      waitingForAnswer: this.progress.waitingForAnswer,
      schedulingStarted: this.progress.schedulingStarted,
      lastQuestionAsked: this.progress.lastQuestionAsked,
      questions: this.questions.map(q => ({
        question: q.question,
        field: q.field,
        asked: q.asked,
        answered: q.answered,
        answer: q.answer || '',
        hasAnswer: !!q.answer
      }))
    };
  }
}

module.exports = DiscoveryService;
