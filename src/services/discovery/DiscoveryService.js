// src/services/discovery/DiscoveryService.js - FIXED (NO MOCK DATA, REAL BUSINESS HOURS)
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
        } else if (answer.includes('real estate')) {
          return "Real estate, great! Such a dynamic market.";
        } else if (answer.includes('restaurant') || answer.includes('food')) {
          return "Food service, wonderful! Everyone loves good food.";
        } else if (answer.includes('consulting') || answer.includes('agency')) {
          return "Consulting, perfect! Business expertise is so valuable.";
        } else {
          return "That sounds interesting!";
        }
        
      case 2: // Main product/service
        if (answer.includes('software') || answer.includes('app')) {
          return "Software solutions, that's excellent.";
        } else if (answer.includes('service')) {
          return "Service-based business, fantastic.";
        } else if (answer.includes('product')) {
          return "Product-focused, that's great.";
        } else {
          return "Sounds like a great offering.";
        }
        
      case 3: // Running ads
        if (answer.includes('facebook') || answer.includes('meta')) {
          return "Facebook ads, they can be really effective.";
        } else if (answer.includes('google') || answer.includes('ppc')) {
          return "Google ads, great for capturing intent.";
        } else if (answer.includes('yes')) {
          return "Good, advertising is important for growth.";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "No ads currently, that's okay.";
        } else {
          return "I see, that's helpful to know.";
        }
        
      case 4: // Using CRM - FIXED FOR GOHIGHLEVEL
        if (answer.includes('gohighlevel') || answer.includes('go high level') || answer.includes('highlevel')) {
          return "GoHighLevel, excellent choice! That's a powerful platform. Now, ";
        } else if (answer.includes('hubspot')) {
          return "HubSpot, nice! That's a solid CRM. Now, ";
        } else if (answer.includes('salesforce')) {
          return "Salesforce, perfect! The industry standard. Now, ";
        } else if (answer.includes('pipedrive')) {
          return "Pipedrive, great choice! Very user-friendly. Now, ";
        } else if (answer.includes('yes')) {
          return "Great, having a CRM system is really important. Now, ";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "No CRM currently, that's actually pretty common. Now, ";
        } else {
          return "Perfect, I understand. Now, ";
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
        return acknowledgments[Math.floor(Math.random() * acknowledgments.length)];
    }
  }

  // Get next question that hasn't been asked
  getNextQuestion() {
    const nextQ = this.questions.find((q, index) => !q.asked && index === this.progress.currentQuestionIndex + 1);
    return nextQ;
  }

  // Check if bot just asked a question
  detectQuestionAsked(botMessage) {
    if (!botMessage || this.progress.allQuestionsCompleted) {
      return false;
    }
    
    const botContent = botMessage.toLowerCase();
    const nextQuestionIndex = this.progress.currentQuestionIndex + 1;
    
    if (nextQuestionIndex >= this.questions.length) {
      return false;
    }
    
    const nextQuestion = this.questions[nextQuestionIndex];
    let detected = false;
    
    switch (nextQuestionIndex) {
      case 0: // How did you hear about us?
        detected = botContent.includes('how') && botContent.includes('hear') && botContent.includes('about');
        break;
        
      case 1: // What industry or business are you in?
        detected = (botContent.includes('industry') || botContent.includes('business')) && 
                  botContent.includes('what') &&
                  !botContent.includes('available') &&
                  !botContent.includes('schedule');
        break;
        
      case 2: // What's your main product or service?
        detected = (botContent.includes('product') || botContent.includes('service')) && 
                  botContent.includes('main') &&
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

  // FIXED: Better answer capture with improved CRM detection
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
    const isSchedulingRequest = schedulingKeywords.some(keyword => userLower.includes(keyword));
    
    // Handle scheduling interruption
    if (isSchedulingRequest && !this.progress.allQuestionsCompleted) {
      console.log('⚠️ Scheduling request detected during discovery - buffering');
      return;
    }
    
    // FIXED: Better CRM detection including GoHighLevel variations
    if (this.progress.currentQuestionIndex === 4) { // CRM question
      const crmKeywords = ['gohighlevel', 'go high level', 'highlevel', 'hubspot', 'salesforce', 
                          'pipedrive', 'zoho', 'monday', 'clickup', 'notion', 'keap', 'activecampaign'];
      const hasCRM = crmKeywords.some(crm => userLower.includes(crm));
      
      if (hasCRM || userLower.includes('yes') || userLower.includes('no') || userLower.includes('not using')) {
        // Process the answer immediately for CRM question
        this.isCapturingAnswer = true;
        currentQ.answer = userMessage;
        currentQ.answered = true;
        this.progress.questionsCompleted++;
        this.progress.waitingForAnswer = false;
        this.discoveryData[currentQ.field] = userMessage;
        
        console.log(`✅ CAPTURED Answer ${this.progress.currentQuestionIndex + 1}: "${userMessage}"`);
        
        // Move to next question (pain points)
        if (this.progress.currentQuestionIndex < 5) {
          console.log('➡️ Moving to question 6: Pain points');
        } else {
          this.progress.allQuestionsCompleted = true;
          console.log('🎯 All discovery questions completed!');
        }
        
        this.isCapturingAnswer = false;
        return;
      }
    }
    
    // Start capture process for other questions
    this.isCapturingAnswer = true;
    this.userResponseBuffer.push(userMessage);
    
    // Clear existing timer
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
    }
    
    // Set timer to finalize answer capture
    this.answerCaptureTimer = setTimeout(() => {
      if (this.userResponseBuffer.length > 0) {
        const fullAnswer = this.userResponseBuffer.join(' ').trim();
        currentQ.answer = fullAnswer;
        currentQ.answered = true;
        this.progress.questionsCompleted++;
        this.progress.waitingForAnswer = false;
        this.discoveryData[currentQ.field] = fullAnswer;
        
        console.log(`✅ CAPTURED Answer ${this.progress.currentQuestionIndex + 1}: "${fullAnswer}"`);
        
        // Check if all questions are complete
        if (this.progress.questionsCompleted >= 6) {
          this.progress.allQuestionsCompleted = true;
          console.log('🎯 All discovery questions completed!');
        }
        
        // Clear buffer
        this.userResponseBuffer = [];
      }
      
      this.isCapturingAnswer = false;
      this.answerCaptureTimer = null;
    }, 1500); // 1.5 seconds to capture complete answer
  }

  // FIXED: Better validation
  isValidAnswerForQuestion(answer, questionIndex) {
    const answerLower = answer.toLowerCase();
    
    // Block obvious scheduling requests
    const schedulingPhrases = [
      'tuesday at', 'monday at', 'wednesday at', 'thursday at', 'friday at',
      'next week', 'tomorrow at', 'today at', 'available times', 'what times'
    ];
    
    const isSchedulingPhrase = schedulingPhrases.some(phrase => answerLower.includes(phrase));
    if (isSchedulingPhrase) {
      return false;
    }
    
    // Minimum answer length check (except for yes/no questions)
    if (questionIndex === 3 || questionIndex === 4) { // Ads and CRM questions
      return answer.length > 1; // Allow short answers like "no"
    }
    
    return answer.length > 2; // Other questions need slightly longer answers
  }

  // Check if ready for scheduling
  isReadyForScheduling() {
    return this.progress.allQuestionsCompleted && !this.progress.schedulingStarted;
  }

  // Mark scheduling as started
  markSchedulingStarted() {
    this.progress.schedulingStarted = true;
    console.log('📅 Scheduling phase started');
  }

  // Get current progress
  getProgress() {
    return {
      currentQuestion: this.progress.currentQuestionIndex + 1,
      totalQuestions: this.questions.length,
      questionsCompleted: this.progress.questionsCompleted,
      allQuestionsCompleted: this.progress.allQuestionsCompleted,
      waitingForAnswer: this.progress.waitingForAnswer,
      lastQuestionAsked: this.progress.lastQuestionAsked,
      schedulingStarted: this.progress.schedulingStarted
    };
  }

  // Get discovery data
  getDiscoveryData() {
    return this.discoveryData;
  }

  // Get formatted summary
  getSummary() {
    return this.questions
      .filter(q => q.answered)
      .map(q => `${q.question} ${q.answer} ✓`)
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
