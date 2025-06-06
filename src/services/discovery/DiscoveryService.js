// src/services/discovery/DiscoveryService.js - Improved Question Detection
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

  // IMPROVED: More precise question detection
  detectQuestionAsked(botMessage) {
    const botContent = botMessage.toLowerCase();
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
    
    // More specific detection patterns
    switch (nextQuestionIndex) {
      case 0: // How did you hear about us?
        detected = (botContent.includes('hear about') && botContent.includes('us')) || 
                  (botContent.includes('find') && botContent.includes('us')) ||
                  (botContent.includes('found') && botContent.includes('us'));
        break;
        
      case 1: // What industry or business are you in?
        detected = (botContent.includes('industry') || 
                   (botContent.includes('business') && botContent.includes('in'))) && 
                   !botContent.includes('hear about');
        break;
        
      case 2: // What's your main product or service?
        detected = ((botContent.includes('product') || botContent.includes('service')) && 
                   (botContent.includes('main') || botContent.includes('your'))) && 
                   !botContent.includes('industry') && !botContent.includes('business');
        break;
        
      case 3: // Are you currently running any ads?
        detected = (botContent.includes('running') && botContent.includes('ads')) || 
                  (botContent.includes('advertising') && botContent.includes('currently')) ||
                  (botContent.includes('ads') && botContent.includes('any'));
        break;
        
      case 4: // Are you using any CRM system?
        detected = botContent.includes('crm') || 
                  (botContent.includes('using') && botContent.includes('system')) ||
                  (botContent.includes('customer') && botContent.includes('management'));
        break;
        
      case 5: // What are your biggest pain points or challenges?
        detected = (botContent.includes('pain point') || botContent.includes('challenge')) && 
                  (botContent.includes('biggest') || botContent.includes('main'));
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
      return true;
    }
    
    return false;
  }

  // IMPROVED: Better answer validation
  captureUserAnswer(userMessage) {
    if (!this.progress.waitingForAnswer || this.isCapturingAnswer) {
      return;
    }
    
    const currentQ = this.questions[this.progress.currentQuestionIndex];
    if (!currentQ || currentQ.answered) {
      return;
    }
    
    // Don't capture scheduling requests as discovery answers
    const schedulingKeywords = ['schedule', 'book', 'appointment', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'am', 'pm'];
    const isSchedulingRequest = schedulingKeywords.some(keyword => 
      userMessage.toLowerCase().includes(keyword)
    );
    
    if (isSchedulingRequest && this.progress.questionsCompleted >= 4) {
      console.log(`⚠️ Detected scheduling request, not capturing as discovery answer: "${userMessage}"`);
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
      } else {
        console.log(`⚠️ Answer doesn't seem to match question ${this.progress.currentQuestionIndex + 1}, waiting for better answer`);
        // Don't mark as answered, keep waiting
      }
      
      this.userResponseBuffer = [];
      this.isCapturingAnswer = false;
      this.answerCaptureTimer = null;
      
    }, 2000); // Reduced from 3000ms to 2000ms
  }

  // NEW: Validate if answer makes sense for the question
  isValidAnswerForQuestion(answer, questionIndex) {
    const answerLower = answer.toLowerCase();
    
    // Very basic validation - just check it's not obviously wrong
    switch (questionIndex) {
      case 0: // How did you hear about us?
        // Should not contain scheduling words
        return !answerLower.includes('tuesday') && !answerLower.includes('monday') && 
               !answerLower.includes('10') && !answerLower.includes('am');
               
      case 5: // Pain points
        // Should not be a scheduling request
        return !answerLower.includes('tuesday at') && !answerLower.includes('monday at');
        
      default:
        return answer.length > 1; // Basic check
    }
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

  // Generate context prompt for AI with stricter instructions
  generateContextPrompt() {
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

DISCOVERY STATUS:
COMPLETED (${this.progress.questionsCompleted}/6):
${completed || 'None yet'}

NEXT TO ASK:
${questionNumber}. ${nextUnanswered.question}${acknowledgmentInstruction}

CRITICAL INSTRUCTIONS:
- Ask question ${questionNumber} EXACTLY as written above
- Wait for a complete answer before moving to the next question  
- Do NOT skip questions or assume answers
- Do NOT start scheduling until ALL 6 questions are complete
- If user tries to schedule, say "Let me finish getting some information first"`;
      }
    }
    return null;
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

  // Mark scheduling as started (prevents loops)
  markSchedulingStarted() {
    this.progress.schedulingStarted = true;
  }

  // Check if scheduling can start
  canStartScheduling() {
    return this.progress.allQuestionsCompleted && !this.progress.schedulingStarted;
  }
}

module.exports = DiscoveryService;
