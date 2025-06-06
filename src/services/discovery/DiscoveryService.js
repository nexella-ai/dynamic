// src/services/discovery/DiscoveryService.js - Discovery Questions Management
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
      schedulingStarted: false
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
      schedulingStarted: false
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
      case 0:
        if (answer.includes('instagram') || answer.includes('social media')) {
          return "Instagram, nice! Social media is huge these days.";
        } else if (answer.includes('google') || answer.includes('search')) {
          return "Found us through Google, perfect.";
        } else if (answer.includes('referral') || answer.includes('friend') || answer.includes('recommend')) {
          return "Word of mouth referrals are the best!";
        } else {
          return "Great, thanks for sharing that.";
        }
        
      case 1:
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
          return `So you're in the ${answer.split(' ')[0]} industry, that's great.`;
        }
        
      case 2:
        if (answer.includes('solar')) {
          return "Solar installations, excellent choice for the market.";
        } else if (answer.includes('coaching') || answer.includes('consulting')) {
          return "Coaching services, that's valuable work.";
        } else if (answer.includes('software') || answer.includes('app')) {
          return "Software solutions, perfect for today's market.";
        } else {
          return "Got it, that sounds like a great service.";
        }
        
      case 3:
        if (answer.includes('yes') || answer.includes('google') || answer.includes('facebook') || answer.includes('meta')) {
          return "Great, so you're already running ads. That's smart.";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "No ads currently, that's totally fine.";
        } else {
          return "Got it, thanks for that info.";
        }
        
      case 4:
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
        
      case 5:
        if (answer.includes('lead') || answer.includes('follow up')) {
          return "Lead follow-up challenges, I totally get that.";
        } else if (answer.includes('time') || answer.includes('busy')) {
          return "Time management issues, that's so common in business.";
        } else if (answer.includes('money') || answer.includes('expensive')) {
          return "Budget concerns, completely understandable.";
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

  // Detect if a question was asked in the bot's message
  detectQuestionAsked(botMessage) {
    const botContent = botMessage.toLowerCase();
    const nextQuestionIndex = this.questions.findIndex(q => !q.asked);
    
    if (nextQuestionIndex === -1) {
      return false;
    }
    
    if (this.progress.waitingForAnswer) {
      return false;
    }
    
    const nextQuestion = this.questions[nextQuestionIndex];
    let detected = false;
    
    switch (nextQuestionIndex) {
      case 0:
        detected = botContent.includes('hear about') || botContent.includes('find us');
        break;
      case 1:
        detected = (botContent.includes('industry') || botContent.includes('business')) && !botContent.includes('hear about');
        break;
      case 2:
        detected = (botContent.includes('product') || botContent.includes('service')) && !botContent.includes('industry');
        break;
      case 3:
        detected = (botContent.includes('running') && botContent.includes('ads')) || botContent.includes('advertising');
        break;
      case 4:
        detected = botContent.includes('crm') || (botContent.includes('using') && botContent.includes('system'));
        break;
      case 5:
        detected = botContent.includes('pain point') || botContent.includes('challenge') || botContent.includes('biggest');
        break;
    }
    
    if (detected) {
      console.log(`✅ DETECTED Question ${nextQuestionIndex + 1}: "${nextQuestion.question}"`);
      nextQuestion.asked = true;
      this.progress.currentQuestionIndex = nextQuestionIndex;
      this.progress.waitingForAnswer = true;
      this.userResponseBuffer = [];
      return true;
    }
    
    return false;
  }

  // Capture user's answer to the current question
  captureUserAnswer(userMessage) {
    if (!this.progress.waitingForAnswer || this.isCapturingAnswer) {
      return;
    }
    
    const currentQ = this.questions[this.progress.currentQuestionIndex];
    if (!currentQ || currentQ.answered) {
      return;
    }
    
    console.log(`📝 Buffering answer for Q${this.progress.currentQuestionIndex + 1}: "${userMessage}"`);
    
    this.userResponseBuffer.push(userMessage.trim());
    
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
    }
    
    this.answerCaptureTimer = setTimeout(() => {
      if (this.isCapturingAnswer) return;
      
      this.isCapturingAnswer = true;
      
      const completeAnswer = this.userResponseBuffer.join(' ');
      
      currentQ.answered = true;
      currentQ.answer = completeAnswer;
      this.discoveryData[currentQ.field] = completeAnswer;
      this.discoveryData[`question_${this.progress.currentQuestionIndex}`] = completeAnswer;
      
      this.progress.questionsCompleted++;
      this.progress.waitingForAnswer = false;
      this.progress.allQuestionsCompleted = this.questions.every(q => q.answered);
      
      console.log(`✅ CAPTURED Q${this.progress.currentQuestionIndex + 1}: "${completeAnswer}"`);
      console.log(`📊 Progress: ${this.progress.questionsCompleted}/6 questions completed`);
      
      this.userResponseBuffer = [];
      this.isCapturingAnswer = false;
      this.answerCaptureTimer = null;
      
    }, 3000);
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

  // Generate context prompt for AI
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

CRITICAL: Ask question ${questionNumber} next. Do NOT repeat completed questions. Do NOT skip to scheduling until all 6 are done.`;
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
      questions: this.questions.map(q => ({
        question: q.question,
        field: q.field,
        asked: q.asked,
        answered: q.answered,
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