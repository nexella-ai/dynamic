// src/handlers/DealershipWebSocketHandler.js - Professional Dealership Flow
const configLoader = require('../services/config/ConfigurationLoader');
const { 
  autoBookAppointment, 
  isCalendarInitialized, 
  getAvailableTimeSlots 
} = require('../services/calendar/CalendarHelpers');
const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');

class DealershipWebSocketHandler {
  constructor(ws, req, companyId) {
    this.ws = ws;
    this.req = req;
    this.companyId = companyId;
    this.config = null;
    
    // Extract call ID
    const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
    this.callId = callIdMatch ? `call_${callIdMatch[1]}` : `call_${Date.now()}`;
    
    // Track conversation
    this.messageCount = 0;
    this.customerInfo = {
      name: null,
      firstName: null,
      phone: null,
      email: null,
      // Vehicle interests
      currentVehicle: null,
      vehicleType: null, // SUV, truck, sedan
      modelInterest: null,
      usage: null, // commuting, family, work
      timeline: null,
      budget: null,
      // Specific choices
      recommendedModels: [],
      selectedModel: null,
      colorPreference: null,
      trimPreference: null,
      // Trade-in
      hasTradeIn: false,
      tradeInDetails: null,
      // Test drive
      testDriveDate: null,
      testDriveTime: null,
      appointmentConfirmed: false
    };
    
    // Professional conversation phases
    this.conversationPhase = 'greeting'; // greeting -> needs_assessment -> recommendation -> test_drive -> appointment -> confirmation
    this.hasGreeted = false;
    this.needsAssessmentComplete = false;
    
    // Response timing for natural flow
    this.responseDelay = 1500;
    this.lastResponseTime = 0;
    
    // Sales consultant assignment
    this.salesConsultant = null;
    
    this.initialize();
  }
  
  async initialize() {
    try {
      // Load configuration
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      console.log(`🚗 ${this.config.companyName} ready`);
      console.log(`📅 Calendar: ${isCalendarInitialized() ? '✅' : '❌'}`);
      
      // Set defaults if missing
      this.ensureConfigDefaults();
      
      // Assign sales consultant
      this.salesConsultant = this.assignSalesConsultant();
      
      // Set up message handler
      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.interaction_type === 'response_required') {
            await this.processMessage(parsed);
          }
        } catch (error) {
          console.error('❌ Error:', error);
        }
      });
      
      this.ws.on('close', () => this.handleClose());
      
    } catch (error) {
      console.error('❌ Init failed:', error);
      this.ws.close();
    }
  }
  
  ensureConfigDefaults() {
    if (!this.config.vehicleInventory) {
      this.config.vehicleInventory = {
        popularModels: ["F-150", "Explorer", "Escape", "Edge", "Bronco", "Mustang", "Maverick", "Expedition"],
        modelsByType: {
          truck: ["F-150", "Ranger", "Maverick", "Super Duty"],
          suv: ["Explorer", "Escape", "Edge", "Expedition", "Bronco", "Bronco Sport"],
          sedan: ["Fusion"],
          sports: ["Mustang"],
          electric: ["Mustang Mach-E", "F-150 Lightning"]
        },
        trimLevels: {
          "F-150": ["Regular Cab", "SuperCab", "SuperCrew", "Lariat", "King Ranch", "Platinum"],
          "Explorer": ["Base", "XLT", "Limited", "ST", "Platinum"],
          "Mustang": ["EcoBoost", "GT", "GT Premium", "Mach 1"],
          "Escape": ["S", "SE", "SEL", "Titanium"]
        },
        commonColors: ["Oxford White", "Agate Black", "Iconic Silver", "Carbonized Gray", "Rapid Red", "Atlas Blue"]
      };
    }
    
    if (!this.config.salesTeam) {
      this.config.salesTeam = [
        { name: "Mike Johnson", specialties: ["Trucks", "Commercial"], yearsExperience: 8 },
        { name: "Sarah Williams", specialties: ["SUVs", "Family vehicles"], yearsExperience: 5 },
        { name: "Tom Davis", specialties: ["Performance", "Mustang"], yearsExperience: 10 },
        { name: "Lisa Chen", specialties: ["Electric", "Hybrid"], yearsExperience: 3 }
      ];
    }
  }
  
  assignSalesConsultant() {
    const consultants = this.config.salesTeam;
    // For now, assign randomly, but in production would check availability
    return consultants[Math.floor(Math.random() * consultants.length)];
  }
  
  async processMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    this.messageCount++;
    
    console.log(`🗣️ Customer: ${userMessage}`);
    console.log(`📊 Phase: ${this.conversationPhase}`);
    
    // Natural conversation delay
    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTime;
    if (timeSinceLastResponse < this.responseDelay) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay - timeSinceLastResponse));
    }
    
    const response = await this.getResponse(userMessage);
    if (response) {
      await this.sendResponse(response, parsed.response_id);
      this.lastResponseTime = Date.now();
    }
  }
  
  async getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    switch (this.conversationPhase) {
      case 'greeting':
        return this.handleGreeting(userMessage);
        
      case 'needs_assessment':
        return this.handleNeedsAssessment(userMessage);
        
      case 'recommendation':
        return this.handleRecommendation(userMessage);
        
      case 'test_drive':
        return this.handleTestDriveInvitation(userMessage);
        
      case 'appointment':
        return this.handleAppointmentSetting(userMessage);
        
      case 'confirmation':
        return this.handleConfirmation(userMessage);
        
      default:
        return null;
    }
  }
  
  handleGreeting(message) {
    if (!this.hasGreeted) {
      this.hasGreeted = true;
      return `Thank you for calling ${this.config.companyName}, this is ${this.salesConsultant.name}. How can I help you today?`;
    }
    
    // Listen to their initial interest
    const lower = message.toLowerCase();
    
    // Extract any specific model mentioned
    const models = this.config.vehicleInventory.popularModels;
    for (const model of models) {
      if (lower.includes(model.toLowerCase())) {
        this.customerInfo.modelInterest = model;
        break;
      }
    }
    
    // Build rapport and transition to needs assessment
    this.conversationPhase = 'needs_assessment';
    
    if (this.customerInfo.modelInterest) {
      return `Great choice! The ${this.customerInfo.modelInterest} is one of our most popular models. What brings you in to look at a Ford today?`;
    } else if (lower.includes('truck')) {
      this.customerInfo.vehicleType = 'truck';
      return `Excellent! We have some fantastic truck options. What brings you in to look at a Ford truck today?`;
    } else if (lower.includes('suv')) {
      this.customerInfo.vehicleType = 'suv';
      return `Perfect! We have a great selection of SUVs. What brings you in to look at a Ford today?`;
    } else {
      return `I'd be happy to help you find the perfect Ford vehicle. What brings you in today?`;
    }
  }
  
  handleNeedsAssessment(message) {
    const lower = message.toLowerCase();
    
    // Track what we've asked about
    const assessmentQuestions = {
      currentSituation: !this.customerInfo.currentVehicle,
      vehicleType: !this.customerInfo.vehicleType && !this.customerInfo.modelInterest,
      usage: !this.customerInfo.usage,
      timeline: !this.customerInfo.timeline,
      budget: !this.customerInfo.budget
    };
    
    // Parse their response for information
    this.extractNeedsInfo(message);
    
    // Determine next question
    if (assessmentQuestions.currentSituation) {
      this.customerInfo.currentVehicle = message; // Store their response
      return `I understand. And what kind of vehicle are you considering - are you looking at trucks, SUVs, or something else?`;
    } else if (assessmentQuestions.vehicleType && !this.customerInfo.vehicleType) {
      return `What type of vehicle works best for your needs - truck, SUV, sedan, or maybe something sporty?`;
    } else if (assessmentQuestions.usage) {
      return `How do you plan to use the vehicle primarily - daily commuting, family trips, work, or a mix?`;
    } else if (assessmentQuestions.timeline) {
      return `When are you looking to make a decision on your next vehicle?`;
    } else if (assessmentQuestions.budget) {
      return `Do you have a price range in mind, or would you like to explore financing options?`;
    } else {
      // We have enough info, move to recommendation
      this.conversationPhase = 'recommendation';
      this.needsAssessmentComplete = true;
      return this.generateRecommendation();
    }
  }
  
  extractNeedsInfo(message) {
    const lower = message.toLowerCase();
    
    // Vehicle type detection
    if (!this.customerInfo.vehicleType) {
      if (lower.includes('truck') || lower.includes('pickup')) {
        this.customerInfo.vehicleType = 'truck';
      } else if (lower.includes('suv') || lower.includes('family')) {
        this.customerInfo.vehicleType = 'suv';
      } else if (lower.includes('sedan') || lower.includes('car')) {
        this.customerInfo.vehicleType = 'sedan';
      } else if (lower.includes('sport') || lower.includes('mustang') || lower.includes('performance')) {
        this.customerInfo.vehicleType = 'sports';
      } else if (lower.includes('electric') || lower.includes('hybrid')) {
        this.customerInfo.vehicleType = 'electric';
      }
    }
    
    // Usage detection
    if (!this.customerInfo.usage) {
      if (lower.includes('commut') || lower.includes('work') || lower.includes('daily')) {
        this.customerInfo.usage = 'commuting';
      } else if (lower.includes('family') || lower.includes('kids')) {
        this.customerInfo.usage = 'family';
      } else if (lower.includes('haul') || lower.includes('tow') || lower.includes('construction')) {
        this.customerInfo.usage = 'work';
      } else if (lower.includes('weekend') || lower.includes('fun')) {
        this.customerInfo.usage = 'recreation';
      }
    }
    
    // Timeline detection
    if (!this.customerInfo.timeline) {
      if (lower.includes('today') || lower.includes('now') || lower.includes('immediate')) {
        this.customerInfo.timeline = 'immediate';
      } else if (lower.includes('week') || lower.includes('soon')) {
        this.customerInfo.timeline = 'this week';
      } else if (lower.includes('month')) {
        this.customerInfo.timeline = 'this month';
      } else if (lower.includes('just looking') || lower.includes('research')) {
        this.customerInfo.timeline = 'researching';
      }
    }
    
    // Budget detection
    if (!this.customerInfo.budget && (lower.includes('$') || lower.includes('k') || lower.includes('thousand'))) {
      this.customerInfo.budget = message; // Store the full response
    }
  }
  
  generateRecommendation() {
    // Generate smart recommendations based on needs
    const recommendations = [];
    const inventory = this.config.vehicleInventory.modelsByType || {};
    
    if (this.customerInfo.modelInterest) {
      recommendations.push(this.customerInfo.modelInterest);
    } else if (this.customerInfo.vehicleType && inventory[this.customerInfo.vehicleType]) {
      recommendations.push(...inventory[this.customerInfo.vehicleType].slice(0, 3));
    } else {
      // Default recommendations
      recommendations.push('F-150', 'Explorer', 'Escape');
    }
    
    this.customerInfo.recommendedModels = recommendations;
    
    let response = `Based on what you've told me, I have some great options for you. `;
    
    if (recommendations.length === 1) {
      response += `The ${recommendations[0]} would be perfect for your needs. `;
      const features = this.getModelHighlights(recommendations[0]);
      response += features;
    } else {
      response += `I'd recommend looking at the ${recommendations.slice(0, -1).join(', ')} or the ${recommendations[recommendations.length - 1]}. `;
      response += `Each has unique features that would work great for ${this.customerInfo.usage || 'your needs'}.`;
    }
    
    return response;
  }
  
  getModelHighlights(model) {
    const highlights = {
      'F-150': "It's America's best-selling truck with incredible towing capacity and the latest SYNC 4 technology.",
      'Explorer': "It offers three rows of seating, advanced safety features, and excellent cargo space for family adventures.",
      'Escape': "It's fuel-efficient, packed with technology, and perfect for daily commuting with weekend versatility.",
      'Mustang': "The iconic sports car with thrilling performance and head-turning style.",
      'Bronco': "Built for adventure with legendary off-road capability and removable doors and roof.",
      'Edge': "A stylish mid-size SUV with plenty of space and comfort features.",
      'Maverick': "Our compact truck that's perfect for city driving with the utility you need."
    };
    
    return highlights[model] || "It has some amazing features I think you'd love to experience.";
  }
  
  handleRecommendation(message) {
    const lower = message.toLowerCase();
    
    // Check if they showed interest in a specific model
    for (const model of this.customerInfo.recommendedModels) {
      if (lower.includes(model.toLowerCase())) {
        this.customerInfo.selectedModel = model;
        break;
      }
    }
    
    // If no specific model selected, pick the first recommendation
    if (!this.customerInfo.selectedModel && this.customerInfo.recommendedModels.length > 0) {
      this.customerInfo.selectedModel = this.customerInfo.recommendedModels[0];
    }
    
    // Move to test drive invitation
    this.conversationPhase = 'test_drive';
    
    return `Would you like to schedule a test drive so you can experience the ${this.customerInfo.selectedModel || 'Ford'} firsthand? There's really no substitute for getting behind the wheel yourself.`;
  }
  
  handleTestDriveInvitation(message) {
    const lower = message.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('sure') || lower.includes('yeah') || 
        lower.includes('ok') || lower.includes('sounds good') || lower.includes('love to')) {
      
      this.conversationPhase = 'appointment';
      
      // Offer specific time slots
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      return `Excellent! I have some availability this afternoon at 2:00 PM, tomorrow morning at 10:00 AM, or tomorrow at 2:00 PM. Which works best for your schedule?`;
      
    } else if (lower.includes('no') || lower.includes('not') || lower.includes('later')) {
      return `No problem at all! Would you like me to send you some information about the ${this.customerInfo.selectedModel || 'vehicles'} to review first? I'm here whenever you're ready.`;
    } else {
      return `I'd love to help you experience the ${this.customerInfo.selectedModel || 'vehicle'} in person. When would be a good time for you to come in for a test drive?`;
    }
  }
  
  handleAppointmentSetting(message) {
    const lower = message.toLowerCase();
    
    // First, try to extract time preference
    if (!this.customerInfo.testDriveDate || !this.customerInfo.testDriveTime) {
      const timeExtracted = this.extractAppointmentTime(message);
      
      if (timeExtracted) {
        this.customerInfo.testDriveDate = timeExtracted.date;
        this.customerInfo.testDriveTime = timeExtracted.time;
        
        // Now get their name
        return `Perfect! I'll get that scheduled for ${timeExtracted.date} at ${timeExtracted.time}. Can I get your full name for the appointment?`;
      } else {
        return `What time works best for you? I have morning and afternoon slots available both today and tomorrow.`;
      }
    }
    
    // Get name if we don't have it
    if (!this.customerInfo.name) {
      this.customerInfo.name = this.extractName(message);
      if (this.customerInfo.name) {
        return `Thank you, ${this.customerInfo.firstName || this.customerInfo.name}. And what's the best phone number to reach you at?`;
      } else {
        return `Could you please tell me your full name for the appointment?`;
      }
    }
    
    // Get phone if we don't have it
    if (!this.customerInfo.phone) {
      const phone = this.extractPhone(message);
      if (phone) {
        this.customerInfo.phone = phone;
        return `Great! And I'll need to confirm you have a valid driver's license for the test drive. You can bring that with you. Now let me confirm all the details...`;
      } else {
        return `What's the best phone number to reach you at?`;
      }
    }
    
    // If we have all info, move to confirmation
    if (this.customerInfo.name && this.customerInfo.phone && this.customerInfo.testDriveDate && this.customerInfo.testDriveTime) {
      this.conversationPhase = 'confirmation';
      return this.generateConfirmation();
    }
    
    return `Let me make sure I have all your information correct...`;
  }
  
  extractAppointmentTime(message) {
    const lower = message.toLowerCase();
    let date = null;
    let time = null;
    
    // Date extraction
    if (lower.includes('today') || lower.includes('afternoon')) {
      date = 'today';
    } else if (lower.includes('tomorrow')) {
      date = 'tomorrow';
    } else if (lower.includes('monday')) {
      date = 'Monday';
    } else if (lower.includes('tuesday')) {
      date = 'Tuesday';
    } else if (lower.includes('wednesday')) {
      date = 'Wednesday';
    } else if (lower.includes('thursday')) {
      date = 'Thursday';
    } else if (lower.includes('friday')) {
      date = 'Friday';
    } else if (lower.includes('saturday')) {
      date = 'Saturday';
    }
    
    // Time extraction
    const timeMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)/i);
    if (timeMatch) {
      const hour = timeMatch[1];
      const period = timeMatch[3].toUpperCase();
      time = `${hour}:00 ${period}`;
    } else if (lower.includes('morning')) {
      time = '10:00 AM';
      if (!date) date = 'tomorrow';
    } else if (lower.includes('afternoon')) {
      time = '2:00 PM';
      if (!date) date = 'today';
    } else if (lower.includes('2') || lower.includes('two')) {
      time = '2:00 PM';
    } else if (lower.includes('10') || lower.includes('ten')) {
      time = '10:00 AM';
    }
    
    if (date && time) {
      return { date, time };
    }
    
    return null;
  }
  
  extractName(message) {
    // Simple name extraction - in production would be more sophisticated
    const words = message.split(' ');
    
    // Look for common name patterns
    if (words.length === 2 && words[0][0] === words[0][0].toUpperCase() && words[1][0] === words[1][0].toUpperCase()) {
      this.customerInfo.firstName = words[0];
      this.customerInfo.lastName = words[1];
      return words.join(' ');
    } else if (words.length === 1 && words[0][0] === words[0][0].toUpperCase()) {
      this.customerInfo.firstName = words[0];
      return words[0];
    }
    
    // Check for "My name is..." pattern
    const nameMatch = message.match(/(?:name is|i'm|i am|it's)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i);
    if (nameMatch) {
      this.customerInfo.firstName = nameMatch[1];
      if (nameMatch[2]) {
        this.customerInfo.lastName = nameMatch[2];
        return `${nameMatch[1]} ${nameMatch[2]}`;
      }
      return nameMatch[1];
    }
    
    return null;
  }
  
  extractPhone(message) {
    const phoneMatch = message.match(/(\d{3})[\s.-]?(\d{3})[\s.-]?(\d{4})/);
    if (phoneMatch) {
      return `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`;
    }
    return null;
  }
  
  generateConfirmation() {
    const model = this.customerInfo.selectedModel || 'Ford';
    const name = this.customerInfo.firstName || this.customerInfo.name;
    
    return `Perfect, ${name}! I have you scheduled for a test drive of the ${model} on ${this.customerInfo.testDriveDate} at ${this.customerInfo.testDriveTime}. ` +
           `I'll have the vehicle ready and warmed up for you. Plan on about an hour total - we'll have the paperwork ready and can discuss financing options afterward if you'd like. ` +
           `My direct number is ${this.config.companyPhone}, and I'll send you a confirmation text to ${this.customerInfo.phone}. ` +
           `I'm looking forward to meeting you on ${this.customerInfo.testDriveDate} at ${this.customerInfo.testDriveTime}. Drive safely!`;
  }
  
  handleConfirmation(message) {
    // Handle any final questions or confirmations
    const lower = message.toLowerCase();
    
    if (lower.includes('thank') || lower.includes('great') || lower.includes('perfect') || lower.includes('see you')) {
      return `You're very welcome! See you ${this.customerInfo.testDriveDate}. Have a great day!`;
    } else if (lower.includes('change') || lower.includes('different')) {
      return `Of course! What would you like to change about your appointment?`;
    } else {
      return `Is there anything else I can help you with before your test drive?`;
    }
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 ${this.salesConsultant.name}: ${content}`);
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId
    }));
  }
  
  async handleClose() {
    console.log('🔌 Call ended');
    console.log(`📊 Summary:`);
    console.log(`  - Customer: ${this.customerInfo.name || 'Unknown'}`);
    console.log(`  - Interest: ${this.customerInfo.selectedModel || this.customerInfo.vehicleType || 'General inquiry'}`);
    console.log(`  - Test Drive: ${this.customerInfo.testDriveDate} at ${this.customerInfo.testDriveTime}`);
    console.log(`  - Sales Consultant: ${this.salesConsultant.name}`);
    
    // Send webhook with all information
    if (this.customerInfo.name || this.customerInfo.phone) {
      await sendSchedulingPreference(
        this.customerInfo.name || 'Unknown',
        this.customerInfo.email || `${(this.customerInfo.firstName || 'customer').toLowerCase()}.${this.callId}@${this.config.companyName.replace(/\s+/g, '').toLowerCase()}.com`,
        this.customerInfo.phone || 'Unknown',
        this.customerInfo.testDriveDate && this.customerInfo.testDriveTime ? 
          `${this.customerInfo.testDriveDate} at ${this.customerInfo.testDriveTime}` : 
          'No appointment scheduled',
        this.callId,
        {
          dealership: this.config.companyName,
          salesConsultant: this.salesConsultant.name,
          vehicleType: this.customerInfo.vehicleType,
          selectedModel: this.customerInfo.selectedModel,
          recommendedModels: this.customerInfo.recommendedModels,
          usage: this.customerInfo.usage,
          timeline: this.customerInfo.timeline,
          budget: this.customerInfo.budget,
          currentVehicle: this.customerInfo.currentVehicle,
          testDriveScheduled: !!(this.customerInfo.testDriveDate && this.customerInfo.testDriveTime),
          conversationPhase: this.conversationPhase,
          needsAssessmentComplete: this.needsAssessmentComplete
        }
      );
    }
  }
}

module.exports = DealershipWebSocketHandler;
