// src/handlers/DealershipWebSocketHandler.js
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
      // Dealership specific
      vehicleInterest: null,
      modelInterest: null,
      trimInterest: null,
      colorPreference: null,
      newOrUsed: null,
      timeline: null,
      hasTradeIn: false,
      tradeInDetails: null,
      // Scheduling
      testDriveDate: null,
      testDriveTime: null,
      salesConsultant: null,
      appointmentBooked: false
    };
    
    // Conversation state
    this.conversationPhase = 'greeting';
    this.hasGreeted = false;
    this.waitingForResponse = false;
    
    // Response timing
    this.responseDelay = 1500;
    this.lastResponseTime = 0;
    
    this.initialize();
  }
  
  async initialize() {
    try {
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      console.log(`🚗 ${this.config.companyName} ready`);
      console.log(`📅 Calendar: ${isCalendarInitialized() ? '✅' : '❌'}`);
      
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
  
  async processMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    this.messageCount++;
    
    console.log(`🗣️ Customer: ${userMessage}`);
    console.log(`📊 Phase: ${this.conversationPhase}`);
    
    // Add small delay for natural conversation
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
        if (!this.hasGreeted) {
          this.hasGreeted = true;
          return this.config.aiAgent.greeting;
        }
        // Customer states their interest
        if (this.detectVehicleInterest(userMessage)) {
          return this.handleVehicleInterest(userMessage);
        }
        break;
        
      case 'get_name':
        return this.handleNameCapture(userMessage);
        
      case 'vehicle_details':
        return this.handleVehicleDetails(userMessage);
        
      case 'color_preference':
        return this.handleColorPreference(userMessage);
        
      case 'scheduling':
        return this.handleScheduling(userMessage);
        
      case 'contact_info':
        return this.handleContactInfo(userMessage);
        
      case 'trade_in':
        return this.handleTradeIn(userMessage);
        
      case 'confirmation':
        return this.handleConfirmation(userMessage);
    }
    
    return null;
  }
  
  detectVehicleInterest(message) {
    const lower = message.toLowerCase();
    const keywords = ['looking', 'interested', 'website', 'test drive', 'schedule', 'appointment'];
    const models = this.config.vehicleInventory.popularModels.map(m => m.toLowerCase());
    
    const hasKeyword = keywords.some(k => lower.includes(k));
    const hasModel = models.some(m => lower.includes(m.toLowerCase()));
    
    return hasKeyword || hasModel;
  }
  
  handleVehicleInterest(message) {
    // Extract vehicle model if mentioned
    const models = this.config.vehicleInventory.popularModels;
    let foundModel = null;
    
    for (const model of models) {
      if (message.toLowerCase().includes(model.toLowerCase())) {
        foundModel = model;
        break;
      }
    }
    
    if (foundModel) {
      this.customerInfo.modelInterest = foundModel;
    }
    
    // Extract year if mentioned
    const yearMatch = message.match(/20\d{2}/);
    if (yearMatch) {
      this.customerInfo.vehicleInterest = yearMatch[0] + ' ' + (foundModel || 'Ford');
    } else if (foundModel) {
      this.customerInfo.vehicleInterest = foundModel;
    }
    
    this.conversationPhase = 'get_name';
    return "Absolutely! I can help you schedule that test drive. Can I get your first name?";
  }
  
  handleNameCapture(message) {
    // Extract first name
    const namePatterns = [
      /(?:it'?s?|name is|i'?m)\s+([A-Z][a-z]+)/i,
      /^([A-Z][a-z]+)$/
    ];
    
    let name = null;
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match) {
        name = match[1];
        break;
      }
    }
    
    if (name) {
      this.customerInfo.firstName = name;
      this.customerInfo.name = name;
      this.conversationPhase = 'vehicle_details';
      
      // If we know the model, ask about trim
      if (this.customerInfo.modelInterest) {
        const trimLevels = this.config.vehicleInventory.trimLevels[this.customerInfo.modelInterest];
        if (trimLevels && trimLevels.length > 0) {
          return `Great ${name}! For the ${this.customerInfo.modelInterest}, are you interested in the ${trimLevels.slice(0, 3).join(', ')} trim level?`;
        }
      }
      
      return `Nice to meet you, ${name}! Which Ford model were you interested in test driving?`;
    }
    
    return "I didn't catch your name. Could you tell me your first name please?";
  }
  
  handleVehicleDetails(message) {
    const lower = message.toLowerCase();
    
    // Check for trim level
    if (this.customerInfo.modelInterest) {
      const trimLevels = this.config.vehicleInventory.trimLevels[this.customerInfo.modelInterest] || [];
      for (const trim of trimLevels) {
        if (lower.includes(trim.toLowerCase())) {
          this.customerInfo.trimInterest = trim;
          this.conversationPhase = 'color_preference';
          
          const colors = this.config.vehicleInventory.commonColors.slice(0, 3).join(', ');
          return `Perfect! I see we have several ${trim} models in stock - ${colors}. Do you have a color preference?`;
        }
      }
    }
    
    // If no trim mentioned but they answered, move to color
    if (this.customerInfo.modelInterest) {
      this.conversationPhase = 'color_preference';
      const colors = this.config.vehicleInventory.commonColors.slice(0, 3).join(', ');
      return `Great choice! We have several in stock - ${colors}. Do you have a color preference?`;
    }
    
    return "Which trim level interests you the most?";
  }
  
  handleColorPreference(message) {
    // Store color preference
    const colors = this.config.vehicleInventory.commonColors;
    for (const color of colors) {
      if (message.toLowerCase().includes(color.toLowerCase())) {
        this.customerInfo.colorPreference = color;
        break;
      }
    }
    
    if (!this.customerInfo.colorPreference) {
      this.customerInfo.colorPreference = message.trim();
    }
    
    this.conversationPhase = 'scheduling';
    
    // Get available sales consultants
    const consultant = this.getAvailableSalesConsultant();
    this.customerInfo.salesConsultant = consultant.name;
    
    return `Excellent! I can schedule your test drive with our sales consultant ${consultant.name} for tomorrow at 2 PM or Thursday at 11 AM. Which works better?`;
  }
  
  handleScheduling(message) {
    const lower = message.toLowerCase();
    
    // Parse scheduling preference
    let selectedDay = null;
    let selectedTime = null;
    
    if (lower.includes('tomorrow')) {
      selectedDay = 'tomorrow';
      if (lower.includes('2') || lower.includes('two')) {
        selectedTime = '2 PM';
      }
    } else if (lower.includes('thursday')) {
      selectedDay = 'Thursday';
      if (lower.includes('11') || lower.includes('eleven')) {
        selectedTime = '11 AM';
      }
    }
    
    if (selectedDay && selectedTime) {
      this.customerInfo.testDriveDate = selectedDay;
      this.customerInfo.testDriveTime = selectedTime;
      this.conversationPhase = 'contact_info';
      
      return "Great! I'll need your phone number and email to confirm the appointment.";
    }
    
    return "Which time works better for you - tomorrow at 2 PM or Thursday at 11 AM?";
  }
  
  handleContactInfo(message) {
    const lower = message.toLowerCase();
    
    // Extract phone number
    const phoneMatch = message.match(/(\d{3})[\s.-]?(\d{3})[\s.-]?(\d{4})/);
    if (phoneMatch) {
      this.customerInfo.phone = `+1${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}`;
    }
    
    // Extract email
    const emailMatch = message.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      this.customerInfo.email = emailMatch[1];
    }
    
    // If we have both, move to confirmation
    if (this.customerInfo.phone && this.customerInfo.email) {
      this.conversationPhase = 'trade_in';
      
      const vehicle = `${this.customerInfo.colorPreference} ${this.customerInfo.modelInterest} ${this.customerInfo.trimInterest || ''}`.trim();
      return `Perfect! ${this.customerInfo.firstName}, you're all set for ${this.customerInfo.testDriveDate} at ${this.customerInfo.testDriveTime}. ${this.customerInfo.salesConsultant} will have the ${vehicle} ready for your test drive. They'll also prepare pricing and financing options. Is there anything specific you'd like them to prepare?`;
    }
    
    // Ask for missing info
    if (!this.customerInfo.phone) {
      return "Could you please provide your phone number?";
    } else if (!this.customerInfo.email) {
      return "And your email address?";
    }
  }
  
  handleTradeIn(message) {
    const lower = message.toLowerCase();
    
    if (lower.includes('trade') || lower.includes('trade-in') || lower.includes('trade in')) {
      this.customerInfo.hasTradeIn = true;
      
      // Extract trade-in details
      const yearMatch = message.match(/(\d{4})/);
      const makeMatch = message.match(/(toyota|honda|ford|chevy|chevrolet|nissan|mazda|hyundai|kia|subaru|volkswagen|bmw|mercedes|audi)/i);
      const modelMatch = message.match(/(camry|accord|civic|corolla|f-150|silverado|tahoe|explorer|escape|crv|rav4|highlander|pilot|altima|sentra|rogue|tucson|santa fe|outback|forester)/i);
      
      if (yearMatch || makeMatch || modelMatch) {
        const year = yearMatch ? yearMatch[1] : '';
        const make = makeMatch ? makeMatch[1] : '';
        const model = modelMatch ? modelMatch[1] : '';
        
        this.customerInfo.tradeInDetails = `${year} ${make} ${model}`.trim();
        this.conversationPhase = 'confirmation';
        
        return `I'll make sure ${this.customerInfo.salesConsultant} has trade-in values ready for your ${this.customerInfo.tradeInDetails}. You'll receive a confirmation text shortly. See you ${this.customerInfo.testDriveDate}!`;
      }
    }
    
    // If no trade-in mentioned
    if (lower.includes('no') || lower.includes('nothing')) {
      this.conversationPhase = 'confirmation';
      return `No problem! You'll receive a confirmation text shortly. We look forward to seeing you ${this.customerInfo.testDriveDate}!`;
    }
    
    return "Do you have a vehicle to trade in?";
  }
  
  handleConfirmation(message) {
    return "Thank you! If you have any questions before your appointment, feel free to call us. Have a great day!";
  }
  
  getAvailableSalesConsultant() {
    // Simple logic to assign consultant based on vehicle type
    const consultants = this.config.salesTeam;
    
    if (this.customerInfo.modelInterest) {
      if (['F-150', 'Ranger', 'Maverick'].includes(this.customerInfo.modelInterest)) {
        return consultants.find(c => c.specialties.includes('Trucks')) || consultants[0];
      } else if (['Mustang'].includes(this.customerInfo.modelInterest)) {
        return consultants.find(c => c.specialties.includes('Performance')) || consultants[0];
      } else if (['Explorer', 'Escape', 'Edge', 'Expedition'].includes(this.customerInfo.modelInterest)) {
        return consultants.find(c => c.specialties.includes('SUVs')) || consultants[0];
      }
    }
    
    return consultants[0]; // Default consultant
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 ${this.config.aiAgent.name}: ${content}`);
    
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
    console.log(`  - Customer: ${this.customerInfo.firstName || 'Unknown'}`);
    console.log(`  - Vehicle Interest: ${this.customerInfo.modelInterest || 'Not specified'}`);
    console.log(`  - Test Drive: ${this.customerInfo.testDriveDate} at ${this.customerInfo.testDriveTime}`);
    console.log(`  - Trade-In: ${this.customerInfo.hasTradeIn ? this.customerInfo.tradeInDetails : 'None'}`);
    
    // Book appointment if scheduled
    if (this.customerInfo.testDriveDate && this.customerInfo.testDriveTime && !this.customerInfo.appointmentBooked) {
      await this.bookTestDriveAppointment();
    }
    
    // Send webhook with all information
    if (this.customerInfo.firstName) {
      await sendSchedulingPreference(
        this.customerInfo.name,
        this.customerInfo.email || `${this.customerInfo.firstName.toLowerCase()}.${this.callId}@timshortford.com`,
        this.customerInfo.phone || 'Unknown',
        `${this.customerInfo.testDriveDate} at ${this.customerInfo.testDriveTime}`,
        this.callId,
        {
          dealership: this.config.companyName,
          vehicleInterest: this.customerInfo.vehicleInterest,
          modelInterest: this.customerInfo.modelInterest,
          trimInterest: this.customerInfo.trimInterest,
          colorPreference: this.customerInfo.colorPreference,
          newOrUsed: this.customerInfo.newOrUsed || 'Not specified',
          timeline: this.customerInfo.timeline || 'Not specified',
          hasTradeIn: this.customerInfo.hasTradeIn,
          tradeInDetails: this.customerInfo.tradeInDetails,
          salesConsultant: this.customerInfo.salesConsultant,
          testDriveScheduled: true
        }
      );
    }
  }
  
  async bookTestDriveAppointment() {
    if (!isCalendarInitialized()) return;
    
    try {
      // Calculate actual date/time
      const appointmentDate = this.calculateAppointmentDate(
        this.customerInfo.testDriveDate,
        this.customerInfo.testDriveTime
      );
      
      const vehicle = `${this.customerInfo.colorPreference || ''} ${this.customerInfo.modelInterest || 'Ford'} ${this.customerInfo.trimInterest || ''}`.trim();
      
      const result = await autoBookAppointment(
        this.customerInfo.name,
        this.customerInfo.email,
        this.customerInfo.phone,
        appointmentDate,
        {
          type: 'Test Drive',
          vehicle: vehicle,
          salesConsultant: this.customerInfo.salesConsultant,
          tradeIn: this.customerInfo.tradeInDetails || 'None',
          dealership: this.config.companyName
        }
      );
      
      if (result.success) {
        this.customerInfo.appointmentBooked = true;
        console.log('✅ Test drive appointment booked successfully');
      }
    } catch (error) {
      console.error('❌ Error booking test drive:', error);
    }
  }
  
  calculateAppointmentDate(day, time) {
    const now = new Date();
    let targetDate = new Date();
    
    if (day === 'tomorrow') {
      targetDate.setDate(now.getDate() + 1);
    } else if (day === 'Thursday') {
      const daysUntilThursday = (4 - now.getDay() + 7) % 7 || 7;
      targetDate.setDate(now.getDate() + daysUntilThursday);
    }
    
    // Parse time
    const timeMatch = time.match(/(\d+)\s*(AM|PM)/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const period = timeMatch[2].toUpperCase();
      
      if (period === 'PM' && hour !== 12) hour += 12;
      else if (period === 'AM' && hour === 12) hour = 0;
      
      targetDate.setHours(hour, 0, 0, 0);
    }
    
    return targetDate;
  }
}

module.exports = DealershipWebSocketHandler;
