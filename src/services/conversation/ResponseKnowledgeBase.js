// src/services/conversation/ResponseKnowledgeBase.js
class ResponseKnowledgeBase {
  constructor() {
    // Pain point specific responses
    this.painPointResponses = {
      "not generating enough leads": {
        acknowledgment: "I completely understand how frustrating it can be when you're not getting enough leads coming in. It's like having a great {INDUSTRY} but no one knows about it, right?",
        solution: "For {INDUSTRY} struggling with lead generation, we provide three powerful solutions: Our AI Texting captures website visitors instantly when they're researching, SMS Revive wakes up all those old leads in your database, and our Review Collector boosts your online reputation so people choose you first.",
        urgency: "Most {INDUSTRY} businesses see a 40% increase in leads within the first 30 days."
      },
      
      "not following up with leads quickly enough": {
        acknowledgment: "Oh, I hear this all the time! You get a lead but by the time you follow up, they've already moved on to someone else. Those first few minutes are so critical in {INDUSTRY}.",
        solution: "Our AI responds to every lead in under 5 seconds, answers their questions about {INDUSTRY_SPECIFIC}, qualifies them based on YOUR criteria, and books appointments while your competitors are still checking voicemail.",
        urgency: "In {INDUSTRY}, 78% of customers buy from whoever responds first. We make sure that's always you."
      },
      
      "not speaking to qualified leads": {
        acknowledgment: "That's so frustrating when you spend time talking to people who aren't even a good fit for your {INDUSTRY} services. It's such a waste of valuable time.",
        solution: "Our AI qualification system asks YOUR exact questions - {QUALIFYING_QUESTIONS} - before they ever reach you. You only talk to serious, qualified prospects.",
        urgency: "Imagine getting back 10+ hours per week by only talking to qualified leads."
      },
      
      "miss calls too much": {
        acknowledgment: "Missing calls is literally missing {REVENUE_AMOUNT} opportunities, isn't it? Especially in {INDUSTRY} where each client can be worth so much.",
        solution: "Our AI Voice system ensures you never miss another call. It answers 24/7, qualifies {INDUSTRY} leads, explains your services, and books appointments. If they can't talk, it automatically texts them.",
        urgency: "Every missed call in {INDUSTRY} is potentially a lost {REVENUE_AMOUNT} deal."
      },
      
      "can't handle the amount of leads": {
        acknowledgment: "What a great problem to have, but also overwhelming! It's like being so successful in {INDUSTRY} that success becomes the challenge.",
        solution: "Our complete automation suite handles unlimited leads simultaneously. Every lead gets instant attention, proper qualification, and automatic scheduling. Your CRM stays updated automatically.",
        urgency: "Scale your {INDUSTRY} business without scaling your team."
      },
      
      "mix of everything": {
        acknowledgment: "Wow, it sounds like you're dealing with the full spectrum of growth challenges in {INDUSTRY}. That must feel pretty overwhelming at times.",
        solution: "Our Complete AI Revenue Rescue System solves ALL these problems with one integrated solution. From the moment someone shows interest - whether they call, text, or fill out a form - our AI takes over completely.",
        urgency: "One system, all problems solved. Most {INDUSTRY} businesses see complete transformation in 60 days."
      }
    };

    // Industry-specific details
    this.industryDetails = {
      "solar": {
        industry_specific: "panel types, installation process, tax credits, and energy savings",
        qualifying_questions: "roof ownership, credit score, monthly electric bill, and timeline",
        revenue_amount: "$30,000",
        special_context: "With the federal tax credit deadline approaching, speed is everything.",
        competitors: "other solar companies"
      },
      
      "real estate": {
        industry_specific: "properties, neighborhoods, pricing, and availability",
        qualifying_questions: "budget, pre-approval status, timeline, and must-have features",
        revenue_amount: "$15,000",
        special_context: "In this market, the fastest agent wins the listing.",
        competitors: "other agents"
      },
      
      "med spa": {
        industry_specific: "treatments, recovery time, pricing, and results",
        qualifying_questions: "treatment interests, budget, medical history, and goals",
        revenue_amount: "$5,000",
        special_context: "People are researching multiple providers right now.",
        competitors: "other med spas"
      },
      
      "roofing": {
        industry_specific: "materials, warranties, insurance claims, and timing",
        qualifying_questions: "damage type, insurance coverage, property size, and urgency",
        revenue_amount: "$12,000",
        special_context: "After storms, response time is everything.",
        competitors: "other roofers"
      },
      
      "dental": {
        industry_specific: "procedures, insurance coverage, payment plans, and availability",
        qualifying_questions: "insurance provider, urgency, specific concerns, and budget",
        revenue_amount: "$3,000",
        special_context: "Patients in pain won't wait for callbacks.",
        competitors: "other practices"
      },
      
      "home services": {
        industry_specific: "services, pricing, availability, and warranties",
        qualifying_questions: "problem type, urgency level, property details, and budget",
        revenue_amount: "$2,000",
        special_context: "Emergency calls command premium pricing.",
        competitors: "other contractors"
      },
      
      "law firm": {
        industry_specific: "case types, fees, process, and timeline",
        qualifying_questions: "case details, timeline, budget, and previous representation",
        revenue_amount: "$10,000",
        special_context: "People need help NOW when legal issues arise.",
        competitors: "other firms"
      },
      
      "insurance": {
        industry_specific: "coverage options, pricing, deductibles, and claims process",
        qualifying_questions: "current coverage, claims history, assets, and needs",
        revenue_amount: "$2,000/year",
        special_context: "Quote shoppers call multiple agents.",
        competitors: "online quote engines"
      },
      
      "e-commerce": {
        industry_specific: "products, shipping, returns, and availability",
        qualifying_questions: "product interests, order size, shipping needs, and timeline",
        revenue_amount: "$500",
        special_context: "Cart abandonment is killing your conversion rate.",
        competitors: "Amazon"
      },
      
      "other": {
        industry_specific: "your services, pricing, and availability",
        qualifying_questions: "needs, budget, timeline, and decision criteria",
        revenue_amount: "thousands in",
        special_context: "In today's market, speed wins.",
        competitors: "your competition"
      }
    };
  }

  /**
   * Get customized response based on pain point and industry
   */
  getCustomResponse(painPoint, industry, responseType = 'acknowledgment') {
    // Normalize inputs
    const normalizedPainPoint = this.normalizePainPoint(painPoint);
    const normalizedIndustry = this.normalizeIndustry(industry);
    
    // Get the response template
    const painPointData = this.painPointResponses[normalizedPainPoint] || this.painPointResponses['mix of everything'];
    const industryData = this.industryDetails[normalizedIndustry] || this.industryDetails['other'];
    
    // Get the specific response type
    let response = painPointData[responseType] || '';
    
    // Replace industry placeholders
    response = response.replace(/{INDUSTRY}/g, industry);
    response = response.replace(/{INDUSTRY_SPECIFIC}/g, industryData.industry_specific);
    response = response.replace(/{QUALIFYING_QUESTIONS}/g, industryData.qualifying_questions);
    response = response.replace(/{REVENUE_AMOUNT}/g, industryData.revenue_amount);
    
    // Add special context if applicable
    if (responseType === 'solution' && industryData.special_context) {
      response += ` ${industryData.special_context}`;
    }
    
    return response;
  }

  /**
   * Normalize pain point to match our keys
   */
  normalizePainPoint(painPoint) {
    if (!painPoint) return 'mix of everything';
    
    const lower = painPoint.toLowerCase();
    
    if (lower.includes('generating') && lower.includes('leads')) {
      return 'not generating enough leads';
    }
    if (lower.includes('following up') || lower.includes('follow up')) {
      return 'not following up with leads quickly enough';
    }
    if (lower.includes('qualified')) {
      return 'not speaking to qualified leads';
    }
    if (lower.includes('miss') && lower.includes('calls')) {
      return 'miss calls too much';
    }
    if (lower.includes('handle') && lower.includes('amount')) {
      return 'can\'t handle the amount of leads';
    }
    if (lower.includes('mix') || lower.includes('everything')) {
      return 'mix of everything';
    }
    
    return 'mix of everything'; // default
  }

  /**
   * Normalize industry to match our keys
   */
  normalizeIndustry(industry) {
    if (!industry) return 'other';
    
    const lower = industry.toLowerCase();
    
    // Check for exact matches first
    const industries = ['solar', 'real estate', 'med spa', 'roofing', 'dental', 'law firm', 'insurance', 'e-commerce'];
    
    for (const ind of industries) {
      if (lower.includes(ind)) {
        return ind;
      }
    }
    
    // Check for related terms
    if (lower.includes('plumb') || lower.includes('hvac') || lower.includes('electric')) {
      return 'home services';
    }
    
    if (lower.includes('medical') || lower.includes('spa') || lower.includes('aesthetic')) {
      return 'med spa';
    }
    
    if (lower.includes('legal') || lower.includes('attorney')) {
      return 'law firm';
    }
    
    if (lower.includes('property') || lower.includes('realtor')) {
      return 'real estate';
    }
    
    return 'other';
  }

  /**
   * Get industry-specific services to recommend
   */
  getRecommendedServices(painPoint, industry) {
    const normalizedPainPoint = this.normalizePainPoint(painPoint);
    
    const serviceMap = {
      'not generating enough leads': ['AI Texting', 'SMS Revive', 'Review Collector'],
      'not following up with leads quickly enough': ['AI Voice Calls', 'SMS Follow-Ups', 'Appointment Bookings'],
      'not speaking to qualified leads': ['AI Voice Calls with Qualification', 'CRM Integration'],
      'miss calls too much': ['AI Voice Calls', 'SMS Follow-Ups'],
      'can\'t handle the amount of leads': ['Complete AI Revenue Rescue System', 'CRM Integration'],
      'mix of everything': ['Complete AI Revenue Rescue System']
    };
    
    return serviceMap[normalizedPainPoint] || ['Complete AI Revenue Rescue System'];
  }

  /**
   * Generate complete conversation flow
   */
  generateConversationScript(connectionData) {
    const industry = connectionData.business_type || connectionData.companyName || 'business';
    const painPoint = connectionData.painPoint || 'growing your business';
    const firstName = connectionData.firstName || 'there';
    const company = connectionData.companyName || 'your company';
    
    return {
      greeting: `Hi ${firstName}! This is Sarah from Nexella AI. How are you doing today?`,
      
      rapportResponse: (userSentiment) => {
        const base = userSentiment === 'positive' ? "That's great to hear! " : "Thanks for letting me know. ";
        return base + this.getCustomResponse(painPoint, industry, 'acknowledgment');
      },
      
      solution: this.getCustomResponse(painPoint, industry, 'solution'),
      
      urgency: this.getCustomResponse(painPoint, industry, 'urgency'),
      
      demoOffer: `You know what, ${firstName}? I'd love to show you exactly how this would work for ${company}. Our founder Jaden does these personalized demo calls where he can show you the system live and create a custom solution for your ${industry} business. It's completely free and incredibly valuable. Would you be interested in seeing how we can solve your ${this.normalizePainPoint(painPoint).replace(/_/g, ' ')} issue?`,
      
      services: this.getRecommendedServices(painPoint, industry)
    };
  }
}

module.exports = ResponseKnowledgeBase;
