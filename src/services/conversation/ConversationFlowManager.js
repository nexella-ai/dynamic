// src/services/conversation/ConversationFlowManager.js
const axios = require('axios');
const config = require('../../config/environment');

class ConversationFlowManager {
  constructor(connectionData, memoryService = null) {
    this.connectionData = connectionData;
    this.memoryService = memoryService;
    
    // Conversation flow state
    this.conversationFlow = {
      phase: 'greeting',
      greetingCompleted: false,
      rapportBuilt: false,
      painPointMentioned: false,
      painPointAcknowledged: false,
      solutionPresented: false,
      schedulingOffered: false,
      bookingInProgress: false
    };
    
    // Context storage
    this.industryContext = null;
    this.painPointContext = null;
    this.solutionContext = null;
    
    // Response control
    this.responseQueue = [];
    this.isProcessingResponse = false;
  }

  /**
   * Initialize context from RAG memory
   */
  async initializeContext() {
    if (!this.memoryService) return;
    
    try {
      // Get industry-specific context
      const industryQuery = `${this.connectionData.business_type || this.connectionData.companyName} industry challenges pain points`;
      this.industryContext = await this.getRAGContext(industryQuery);
      
      // Get pain point specific context
      if (this.connectionData.painPoint) {
        const painPointQuery = `${this.connectionData.business_type} ${this.connectionData.painPoint} solutions`;
        this.painPointContext = await this.getRAGContext(painPointQuery);
      }
      
      console.log('✅ Initialized RAG context for', this.connectionData.business_type);
    } catch (error) {
      console.error('❌ Error initializing context:', error.message);
    }
  }

  /**
   * Get context from RAG memory
   */
  async getRAGContext(query) {
    if (!this.memoryService) return null;
    
    try {
      // Search for relevant memories
      const results = await this.memoryService.retrieveRelevantMemories(
        this.connectionData.customerEmail,
        query,
        3
      );
      
      // Also search Nexella knowledge base
      const nexellaContext = await this.memoryService.generateEnhancedConversationContext(
        this.connectionData.customerEmail,
        query
      );
      
      return {
        memories: results,
        nexellaContext: nexellaContext
      };
    } catch (error) {
      console.error('❌ Error getting RAG context:', error.message);
      return null;
    }
  }

  /**
   * Generate personalized greeting
   */
  async generateQuickGreeting() {
    const firstName = this.connectionData.firstName || 'there';
    
    return `Hi ${firstName}! This is Sarah from Nexella AI. How are you doing today?`;
  }

  /**
   * Generate industry-aware rapport response
   */
  async generateRapportResponse(userResponse) {
    const sentiment = this.detectSentiment(userResponse);
    const firstName = this.connectionData.firstName || '';
    const industry = this.connectionData.business_type || 'business';
    
    // Base response based on sentiment
    let baseResponse = '';
    if (sentiment === 'positive') {
      baseResponse = `That's great to hear, ${firstName}! I'm doing well too, thank you for asking.`;
    } else if (sentiment === 'negative') {
      baseResponse = `I'm sorry to hear that. I hope things get better. I'm doing okay, thanks.`;
    } else {
      baseResponse = `I hear you. I'm doing alright, thanks for asking.`;
    }
    
    // Add industry-specific transition
    const industryTransitions = {
      'solar': `So I was looking at your form about Sunny Solar... I work with a lot of solar companies and I know the industry has its unique challenges...`,
      'real estate': `I was just reviewing what you shared about your real estate business... This market has been particularly challenging...`,
      'roofing': `I saw your submission about your roofing company... I know how competitive and seasonal this business can be...`,
      'dental': `I was looking at what you shared about your dental practice... Managing patient flow and appointments is so critical in healthcare...`,
      'med spa': `I noticed your form about your med spa... This industry is all about client experience and timing...`,
      'dealership': `I saw what you submitted about your dealership... The auto industry has really evolved with how customers shop now...`,
      'law firm': `I was reviewing your law firm's challenges... I know how important every potential client is in legal services...`,
      'insurance': `I looked at your insurance agency's submission... This industry is all about quick response and trust...`,
      'home services': `I saw your form about your home services business... I know how crucial it is to respond fast when someone needs help...`,
      'e-commerce': `I was looking at your e-commerce business challenges... Online retail is so competitive these days...`
    };
    
    const transition = industryTransitions[industry.toLowerCase()] || 
      `I was looking at what you shared about your ${industry} business...`;
    
    return `${baseResponse} ${transition}`;
  }

  /**
   * Generate industry-specific pain point mention
   */
  async generatePainPointMention() {
    const painPoint = this.connectionData.painPoint;
    const company = this.connectionData.companyName || 'your company';
    const industry = this.connectionData.business_type || 'business';
    
    if (!painPoint) return `Tell me, what's been the biggest challenge for ${company} lately?`;
    
    // Get industry-specific context for pain point
    let contextualMention = '';
    
    if (this.painPointContext?.nexellaContext) {
      // Use RAG context if available
      const context = this.painPointContext.nexellaContext;
      contextualMention = await this.generateAIResponse([
        { role: 'system', content: `You're Sarah from Nexella AI. Mention the customer's specific pain point with empathy. 
          Customer: ${this.connectionData.firstName} from ${company} (${industry} industry)
          Pain point: ${painPoint}
          Context: ${context}
          Keep it under 30 words and end with "..."` },
        { role: 'user', content: 'Mention their pain point with understanding.' }
      ], 60);
    } else {
      // Fallback to industry-specific templates
      const painPointTemplates = {
        'solar': {
          'miss calls': `I see that ${company} is missing too many calls. In solar, when someone's ready to talk about panels, every missed call is potentially $20-30k walking away...`,
          'generating': `I noticed ${company} is struggling to generate enough leads. Solar is so competitive now with all the companies out there...`,
          'following up': `I saw you're having trouble following up quickly with solar leads. That 5-minute window is crucial - people are getting multiple quotes...`,
          'qualified': `You mentioned dealing with unqualified leads. It's frustrating when people just want a quote but can't actually afford solar...`,
          'handle': `I see you're overwhelmed with lead volume. That's a great problem for a solar company, but I know it's still stressful...`
        },
        'real estate': {
          'miss calls': `I noticed you're missing calls at ${company}. In real estate, buyers and sellers won't wait - they'll just call the next agent...`,
          'generating': `I saw ${company} needs more leads. With inventory so tight and competition fierce, consistent lead flow is everything...`,
          'following up': `You mentioned slow follow-up with leads. Real estate moves fast - buyers touring homes won't wait for a callback...`,
          'qualified': `I see you're dealing with unqualified leads. Time wasted on lookers means less time for serious buyers and sellers...`,
          'handle': `You're swamped with leads - that's amazing for a real estate business, but I know it's overwhelming...`
        },
        'roofing': {
          'miss calls': `I see ${company} is missing calls. When someone has a leak or storm damage, they need help NOW and will call someone else...`,
          'generating': `I noticed you need more roofing leads. It's tough competing with the big companies' marketing budgets...`,
          'following up': `You mentioned slow follow-up. Roofing customers get multiple quotes fast - speed wins the job...`,
          'qualified': `Dealing with tire-kickers is frustrating. You need to know quickly if they're serious about a new roof...`,
          'handle': `Storm season must be overwhelming you with leads. Great for business but hard to manage...`
        }
      };
      
      // Find matching template
      const industryTemplates = painPointTemplates[industry.toLowerCase()] || {};
      const painLower = painPoint.toLowerCase();
      
      for (const [key, template] of Object.entries(industryTemplates)) {
        if (painLower.includes(key)) {
          contextualMention = template;
          break;
        }
      }
      
      // Generic fallback
      if (!contextualMention) {
        contextualMention = `I see from your form that ${company} is struggling with "${painPoint}". That must be really impacting your ${industry} business...`;
      }
    }
    
    return contextualMention;
  }

  /**
   * Generate industry-specific empathy response
   */
  async generateEmpathyResponse() {
    const painPoint = this.connectionData.painPoint?.toLowerCase() || '';
    const industry = this.connectionData.business_type?.toLowerCase() || '';
    const firstName = this.connectionData.firstName || '';
    
    // Try to get RAG-enhanced response
    if (this.memoryService && this.industryContext) {
      const context = this.industryContext.nexellaContext || '';
      const response = await this.generateAIResponse([
        { role: 'system', content: `You're Sarah. Show deep empathy for their specific situation.
          Customer: ${firstName} in ${industry}
          Pain: ${painPoint}
          Context: ${context}
          Give a short (under 25 words) empathetic response that shows you understand their specific industry challenge.` },
        { role: 'user', content: 'I need an empathetic response.' }
      ], 50);
      
      if (response && response.length > 10) {
        return response;
      }
    }
    
    // Industry-specific empathy fallbacks
    const industryEmpathy = {
      'solar': {
        'miss calls': `Exactly! In solar, timing is everything. When someone's ready to go solar, they want answers immediately. Missing that call often means losing them to a competitor who picked up.`,
        'generating': `Solar lead generation is brutal. Between Google Ads costs and competing with SunRun and Tesla, getting quality leads is expensive and difficult.`,
        'following up': `I totally get it. Solar buyers are shopping around fast. If you don't reach them within an hour, they've probably already scheduled with someone else.`,
        'qualified': `That's so frustrating! You spend time educating someone about solar savings, only to find out they're renting or have terrible credit.`,
        'handle': `What a double-edged sword! All those solar leads from your marketing working, but now you can't give each one the attention they deserve.`
      },
      'real estate': {
        'miss calls': `Absolutely! Buyers and sellers are impatient. They're calling multiple agents, and whoever answers first usually gets the listing or showing.`,
        'generating': `With Zillow and Realtor.com dominating, getting your own leads is expensive. And everyone knows an agent these days.`,
        'following up': `Real estate is all about speed. Buyers touring homes this weekend won't wait until Monday for a callback.`,
        'qualified': `Time is money in real estate. Showing homes to browsers who aren't pre-approved is exhausting and unproductive.`,
        'handle': `Success problems! Multiple offers, busy season, but you're just one person trying to serve everyone properly.`
      },
      'roofing': {
        'miss calls': `Definitely! When someone has water dripping through their ceiling, they're calling every roofer until someone answers.`,
        'generating': `Roofing is so seasonal and competitive. Outside of storm season, consistent leads are really hard to come by.`,
        'following up': `I hear you. Homeowners get 5-6 roofing quotes. The first one to follow up professionally usually wins.`,
        'qualified': `It's tough spending time on estimates for people who are just fishing for prices or can't actually afford a new roof.`,
        'handle': `Storm season is crazy! Everyone needs help at once, but you can only be on so many roofs.`
      }
    };
    
    // Find matching empathy
    const industryResponses = industryEmpathy[industry] || {};
    for (const [key, response] of Object.entries(industryResponses)) {
      if (painPoint.includes(key)) {
        return response;
      }
    }
    
    // Generic empathy
    return `I completely understand, ${firstName}. That challenge is really common in the ${industry} industry, and it's definitely holding businesses back from growing.`;
  }

  /**
   * Generate industry-specific solution presentation
   */
  async generateSolutionPresentation() {
    const painPoint = this.connectionData.painPoint?.toLowerCase() || '';
    const industry = this.connectionData.business_type?.toLowerCase() || '';
    const firstName = this.connectionData.firstName || '';
    const company = this.connectionData.companyName || 'your company';
    
    // Get solution from RAG/Nexella knowledge
    if (this.memoryService) {
      const solutionQuery = `${industry} ${painPoint} Nexella AI solution`;
      const solutionContext = await this.getRAGContext(solutionQuery);
      
      if (solutionContext?.nexellaContext) {
        const response = await this.generateAIResponse([
          { role: 'system', content: `You're Sarah. Present how Nexella AI specifically solves their problem.
            Customer: ${firstName} from ${company} (${industry})
            Pain: ${painPoint}
            Nexella Context: ${solutionContext.nexellaContext}
            Keep it under 40 words, specific to their industry.` },
          { role: 'user', content: 'Present the solution.' }
        ], 80);
        
        if (response && response.length > 20) {
          return response;
        }
      }
    }
    
    // Industry-specific solution templates
    const industrySolutions = {
      'solar': {
        'miss calls': `Here's what we do for solar companies like ${company}... Our AI answers every call 24/7, qualifies them on budget and roof ownership, then books consultations directly into your calendar. You'll never miss another $30k solar deal.`,
        'generating': `For solar companies, we triple your lead sources: AI chat captures website visitors asking about savings, SMS campaigns revive old quotes, and our review system builds trust so neighbors call YOU.`,
        'following up': `Our AI responds to solar leads in under 5 seconds. It answers questions about savings, tax credits, and installation time, then books qualified appointments while competitors are still sleeping.`,
        'qualified': `We pre-qualify every solar lead on credit, homeownership, roof age, and electric bill size before they ever reach you. Only serious, qualified buyers make it to your calendar.`,
        'handle': `Our system handles unlimited solar leads simultaneously. Each gets personalized attention, accurate quotes based on their usage, and seamless booking. Your team just shows up to close deals.`
      },
      'real estate': {
        'miss calls': `For real estate agents, our AI becomes your 24/7 assistant. It answers calls, captures leads from Zillow/Realtor.com, schedules showings, and even follows up on open house visitors.`,
        'generating': `We help agents like you get leads beyond the portals: AI chat on your website, SMS campaigns to past clients for referrals, and automated review requests that boost your Google presence.`,
        'following up': `Our AI responds instantly to every real estate lead, answers questions about listings, neighborhoods, and financing, then books property tours directly into your showing schedule.`,
        'qualified': `We qualify buyers on pre-approval, timeline, and specific needs before booking showings. Sellers get qualified on motivation and property details. You only talk to serious clients.`,
        'handle': `Handle every lead perfectly: buyer inquiries get instant property details, sellers get CMAs, and everyone gets booked appropriately. Nothing falls through the cracks during busy season.`
      },
      'roofing': {
        'miss calls': `For roofers, our AI answers emergency calls 24/7, assesses damage urgency, and schedules inspections immediately. Storm damage calls get priority booking so you beat competitors.`,
        'generating': `We help roofing companies generate leads year-round: website chat for quotes, SMS campaigns after storms, and review automation that makes you the trusted neighborhood roofer.`,
        'following up': `Our AI follows up with every roofing lead within minutes, provides ballpark estimates based on roof size, and books inspections while other contractors are still returning voicemails.`,
        'qualified': `We qualify roofing leads on insurance claims, roof age, and budget before you climb any ladders. Only serious replacement and repair jobs reach your schedule.`,
        'handle': `Storm season becomes manageable: AI handles the call surge, prioritizes emergency repairs, books inspections efficiently, and keeps everyone informed. You just focus on the work.`
      }
    };
    
    // Find matching solution
    const industrySet = industrySolutions[industry] || {};
    for (const [key, solution] of Object.entries(industrySet)) {
      if (painPoint.includes(key)) {
        return solution;
      }
    }
    
    // Generic solution
    return `So here's how we help ${industry} businesses... Our AI handles all your customer interactions 24/7, qualifies leads based on YOUR criteria, and books appointments automatically. You focus on serving clients, we handle the rest.`;
  }

  /**
   * Generate demo offer
   */
  generateDemoOffer() {
    const firstName = this.connectionData.firstName || '';
    const company = this.connectionData.companyName || 'your company';
    const industry = this.connectionData.business_type || 'business';
    
    return `You know what, ${firstName}? I'd love to show you exactly how this works for ${industry} companies like ${company}. Jaden, our owner, does personalized demos. Would you like to see it in action?`;
  }

  /**
   * Get next response based on phase
   */
  async getNextResponse(userMessage = '') {
    // Initialize context on first response
    if (!this.industryContext && this.conversationFlow.phase === 'greeting') {
      await this.initializeContext();
    }
    
    switch (this.conversationFlow.phase) {
      case 'greeting':
        if (!this.conversationFlow.greetingCompleted) {
          const greeting = await this.generateQuickGreeting();
          this.conversationFlow.greetingCompleted = true;
          this.conversationFlow.phase = 'rapport';
          return greeting;
        }
        break;
        
      case 'rapport':
        if (userMessage && !this.conversationFlow.rapportBuilt) {
          const rapport = await this.generateRapportResponse(userMessage);
          this.conversationFlow.rapportBuilt = true;
          this.conversationFlow.phase = 'pain_point_mention';
          return rapport;
        }
        break;
        
      case 'pain_point_mention':
        if (!this.conversationFlow.painPointMentioned) {
          const mention = await this.generatePainPointMention();
          this.conversationFlow.painPointMentioned = true;
          this.conversationFlow.phase = 'pain_point_acknowledge';
          return mention;
        }
        break;
        
      case 'pain_point_acknowledge':
        if (userMessage && !this.conversationFlow.painPointAcknowledged) {
          const empathy = await this.generateEmpathyResponse();
          this.conversationFlow.painPointAcknowledged = true;
          this.conversationFlow.phase = 'solution';
          
          // Queue solution for 2 seconds later
          setTimeout(() => {
            this.responseQueue.push(this.generateSolutionPresentation());
            this.conversationFlow.solutionPresented = true;
            
            // Queue demo offer for 3 seconds after solution
            setTimeout(() => {
              this.responseQueue.push(this.generateDemoOffer());
              this.conversationFlow.schedulingOffered = true;
              this.conversationFlow.phase = 'scheduling';
            }, 3000);
          }, 2000);
          
          return empathy;
        }
        break;
        
      default:
        return null;
    }
  }

  /**
   * Generate AI response with context
   */
  async generateAIResponse(messages, maxTokens = 50) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: messages,
          temperature: 0.7,
          max_tokens: maxTokens
        },
        {
          headers: {
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      console.error('AI response error:', error.message);
      return null;
    }
  }

  /**
   * Detect user sentiment
   */
  detectSentiment(userMessage) {
    const lower = userMessage.toLowerCase();
    
    const positiveWords = ['good', 'great', 'awesome', 'excellent', 'fantastic', 'well', 'fine', 'alright', 'okay'];
    const negativeWords = ['bad', 'terrible', 'awful', 'struggling', 'tough', 'hard', 'stressed', 'rough'];
    
    if (positiveWords.some(word => lower.includes(word))) {
      return 'positive';
    } else if (negativeWords.some(word => lower.includes(word))) {
      return 'negative';
    }
    
    return 'neutral';
  }

  /**
   * Check if user wants to schedule
   */
  isSchedulingIntent(userMessage) {
    const lower = userMessage.toLowerCase();
    const positiveIndicators = [
      'yes', 'yeah', 'sure', 'ok', 'sounds good', 'interested',
      'let\'s do it', 'book', 'schedule', 'demo', 'show me'
    ];
    
    return positiveIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Check if we need AI response
   */
  needsAIResponse(userMessage) {
    const complexIndicators = [
      'how', 'what', 'why', 'when', 'where', 'explain',
      'tell me more', 'cost', 'price', 'how much', 'work'
    ];
    
    const lower = userMessage.toLowerCase();
    return complexIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Get conversation state
   */
  getState() {
    return {
      phase: this.conversationFlow.phase,
      readyForScheduling: this.conversationFlow.schedulingOffered && !this.conversationFlow.bookingInProgress,
      bookingInProgress: this.conversationFlow.bookingInProgress,
      completed: this.conversationFlow.phase === 'completed'
    };
  }

  /**
   * Force transition to phase
   */
  transitionTo(phase) {
    console.log(`🔄 Transitioning from ${this.conversationFlow.phase} to ${phase}`);
    this.conversationFlow.phase = phase;
    
    if (phase === 'booking') {
      this.conversationFlow.bookingInProgress = true;
    } else if (phase === 'completed') {
      this.conversationFlow.bookingInProgress = false;
    }
  }

  /**
   * Mark booking as completed
   */
  markBookingComplete() {
    this.conversationFlow.phase = 'completed';
    this.conversationFlow.bookingInProgress = false;
  }
}

module.exports = ConversationFlowManager;
