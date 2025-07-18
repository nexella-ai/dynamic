// src/handlers/DealershipWebSocketHandler.js - PROPER DEALERSHIP HANDLER
const configLoader = require('../services/config/ConfigurationLoader');
const { 
  autoBookAppointment, 
  isCalendarInitialized, 
  initializeCalendarService,
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
      phone: this.extractPhoneFromHeaders(req),
      email: null,
      // Dealership specific fields
      vehicleInterest: null,
      newOrUsed: null,
      tradeIn: null,
      tradeInDetails: null,
      timeline: null,
      // Scheduling
      day: null,
      specificTime: null,
      availableSlots: [],
      selectedSlot: null,
      bookingConfirmed: false,
      bookingDate: null,
      preferredSalesperson: null
    };
    
    console.log(`📞 Caller phone number: ${this.customerInfo.phone || 'Unknown'}`);
    
    // Conversation state - Dealership flow
    this.conversationPhase = 'waiting';
    this.hasGreeted = false;
    this.waitingForTimeSelection = false;
    
    // Response timing
    this.responseDelay = 1500;
    this.lastResponseTime = 0;
    this.pendingResponseTimeout = null;
    
    // Initialize
    this.initialize();
  }
  
  extractPhoneFromHeaders(req) {
    // Same phone extraction logic
    const retellPhone = req.headers['x-retell-phone-number'] || 
                       req.headers['x-retell-caller-number'] ||
                       req.headers['x-retell-from-number'] ||
                       req.headers['x-retell-to-number'] ||
                       req.headers['x-retell-customer-phone'];
    if (retellPhone) {
      console.log('📱 Found phone in Retell headers:', retellPhone);
      return retellPhone;
    }
    
    const genericPhone = req.headers['x-customer-phone'] || 
                        req.headers['x-phone-number'] ||
                        req.headers['x-caller-id'];
    if (genericPhone) {
      console.log('📱 Found phone in generic headers:', genericPhone);
      return genericPhone;
    }
    
    console.log('📱 No phone number found in headers or URL');
    return null;
  }
  
  async initialize() {
    try {
      // Load config and init calendar in parallel
      const [configResult] = await Promise.all([
        configLoader.loadCompanyConfig(this.companyId),
        isCalendarInitialized() ? Promise.resolve() : initializeCalendarService()
      ]);
      
      this.config = configResult;
      console.log(`🚗 ${this.config.companyName} ready`);
      console.log(`🤖 Sales Assistant: ${this.config.aiAgent?.name || 'Assistant'}`);
      console.log(`📅 Calendar: ${isCalendarInitialized() ? '✅' : '❌'}`);
      
      // Load sales team if available
      this.salesTeam = this.config.salesTeam || [];
      this.vehicleInventory = this.config.vehicleInventory || {};
      
      // Set up message handler
      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.interaction_type === 'response_required') {
            const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
            console.log(`🗣️ User: ${userMessage}`);
            
            if (!this.hasGreeted && userMessage.toLowerCase().includes('hello')) {
              // Respond immediately to hello
              this.hasGreeted = true;
              this.conversationPhase = 'greeting';
              const greeting = this.generateDealershipGreeting();
              await this.sendResponse(greeting, parsed.response_id);
            } else {
              // Quick delay for other messages
              if (this.pendingResponseTimeout) clearTimeout(this.pendingResponseTimeout);
              this.pendingResponseTimeout = setTimeout(() => this.processMessage(parsed), this.responseDelay);
            }
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
  
  generateDealershipGreeting() {
    const agentName = this.config.aiAgent?.name || "Sarah";
    const companyName = this.config.companyName || "the dealership";
    const greeting = this.config.aiAgent?.greeting || `Hi! This is ${agentName} from ${companyName}. How can I help you today?`;
    
    return greeting
      .replace('{agentName}', agentName)
      .replace('{companyName}', companyName)
      .replace('{firstName}', this.customerInfo.firstName || 'there');
  }
  
  async processMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    this.messageCount++;
    
    console.log(`🗣️ Customer: ${userMessage}`);
    console.log(`📊 Phase: ${this.conversationPhase}`);
    
    const response = await this.getResponse(userMessage);
    if (response) {
      await this.sendResponse(response, parsed.response_id);
      this.lastResponseTime = Date.now();
    }
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 ${this.config.aiAgent?.name || 'Sarah'}: ${content}`);
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId
    }));
  }
  
  async getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    switch (this.conversationPhase) {
      case 'greeting':
        return this.handleGreetingPhase(userMessage);
        
      case 'vehicle_inquiry':
        return this.handleVehicleInquiry(userMessage);
        
      case 'new_or_used':
        return this.handleNewOrUsed(userMessage);
        
      case 'trade_in':
        return this.handleTradeIn(userMessage);
        
      case 'timeline':
        return this.handleTimeline(userMessage);
        
      case 'name':
        return this.handleName(userMessage);
        
      case 'scheduling':
        return this.handleScheduling(userMessage);
        
      case 'time_selection':
        return this.handleTimeSelection(userMessage);
        
      case 'booking_confirmation':
        return this.handleBookingConfirmation(userMessage);
        
      default:
        return null;
    }
  }
  
  handleGreetingPhase(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('good') || lower.includes('great') || lower.includes('fine')) {
      this.conversationPhase = 'vehicle_inquiry';
      return "That's great to hear! What brings you to " + this.config.companyName + " today? Are you looking for a specific vehicle?";
    } else if (lower.includes('looking') || lower.includes('interested') || lower.includes('test drive')) {
      this.conversationPhase = 'vehicle_inquiry';
      return "Excellent! Which vehicle are you interested in?";
    } else if (lower.includes('browse') || lower.includes('see')) {
      this.conversationPhase = 'vehicle_inquiry';
      return "Of course! Are you looking for a truck, SUV, or car? Or did you have a specific model in mind?";
    } else {
      this.conversationPhase = 'vehicle_inquiry';
      return "How's your day going? What can I help you with today?";
    }
  }
  
  handleVehicleInquiry(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Check for specific models
    const popularModels = this.config.vehicleInventory?.popularModels || [];
    let foundModel = null;
    
    for (const model of popularModels) {
      if (lower.includes(model.toLowerCase())) {
        foundModel = model;
        break;
      }
    }
    
    if (foundModel) {
      this.customerInfo.vehicleInterest = foundModel;
      this.conversationPhase = 'new_or_used';
      
      // Use configured script if available
      const script = this.config.scripts?.vehicleInquiry?.model_interest;
      if (script) {
        return script.replace('{model}', foundModel);
      }
      return `Great choice! The ${foundModel} is one of our most popular vehicles. Are you looking for a new or used ${foundModel}?`;
    } else if (lower.includes('truck')) {
      this.conversationPhase = 'new_or_used';
      return "Excellent choice! We have the F-150, Ranger, and Maverick. Which size truck works best for your needs?";
    } else if (lower.includes('suv')) {
      this.conversationPhase = 'new_or_used';
      return "Great! We have everything from the compact Escape to the full-size Expedition. What size SUV are you looking for?";
    } else {
      return "What type of vehicle are you interested in? We have a great selection of trucks, SUVs, and cars.";
    }
  }
  
  handleNewOrUsed(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('new')) {
      this.customerInfo.newOrUsed = 'new';
    } else if (lower.includes('used')) {
      this.customerInfo.newOrUsed = 'used';
    } else {
      this.customerInfo.newOrUsed = 'both';
    }
    
    this.conversationPhase = 'trade_in';
    return "Perfect! Do you have a vehicle you'd like to trade in?";
  }
  
  handleTradeIn(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('yeah')) {
      this.customerInfo.tradeIn = true;
      this.conversationPhase = 'timeline';
      return "Great! We'll make sure to have our appraisal team ready. When are you looking to make a purchase - this week, this month, or just starting your research?";
    } else {
      this.customerInfo.tradeIn = false;
      this.conversationPhase = 'timeline';
      return "No problem! When are you looking to make a purchase - this week, this month, or just starting your research?";
    }
  }
  
  handleTimeline(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('this week') || lower.includes('soon') || lower.includes('asap')) {
      this.customerInfo.timeline = 'this week';
    } else if (lower.includes('this month')) {
      this.customerInfo.timeline = 'this month';
    } else {
      this.customerInfo.timeline = 'researching';
    }
    
    this.conversationPhase = 'name';
    return "I'd love to help you find the perfect vehicle! What's your first name?";
  }
  
  handleName(userMessage) {
    // Extract name
    const namePatterns = [
      /my name is\s+([A-Z][a-z]+)/i,
      /i'?m\s+([A-Z][a-z]+)/i,
      /it'?s?\s+([A-Z][a-z]+)/i,
      /^([A-Z][a-z]+)$/
    ];
    
    let extractedName = null;
    for (const pattern of namePatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        extractedName = match[1];
        break;
      }
    }
    
    if (extractedName) {
      this.customerInfo.firstName = extractedName;
      this.customerInfo.name = extractedName;
      this.conversationPhase = 'scheduling';
      
      const vehicleText = this.customerInfo.vehicleInterest ? 
        `the ${this.customerInfo.vehicleInterest}` : 'some vehicles';
      
      return `Nice to meet you, ${extractedName}! I'd love to schedule a time for you to come in and ${this.customerInfo.tradeIn ? 'get your trade-in appraised and ' : ''}test drive ${vehicleText}. What day works best for you?`;
    } else {
      return "I didn't catch that - could you tell me your first name please?";
    }
  }
  
  async handleScheduling(userMessage) {
    const lower = userMessage.toLowerCase();
    const days = ['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayFound = days.find(day => lower.includes(day));
    
    if (dayFound) {
      this.customerInfo.day = dayFound.charAt(0).toUpperCase() + dayFound.slice(1);
      this.conversationPhase = 'time_selection';
      
      // Get available slots
      const targetDate = this.getNextDate(dayFound);
      this.customerInfo.bookingDate = targetDate;
      
      const slots = await getAvailableTimeSlots(targetDate);
      
      if (slots.length > 0) {
        this.customerInfo.availableSlots = slots;
        this.waitingForTimeSelection = true;
        
        // Use configured test drive slots if available
        const configSlots = this.config.calendar?.testDriveSlots;
        let availableText = '';
        
        if (configSlots && configSlots[dayFound === 'saturday' ? 'saturday' : dayFound === 'sunday' ? 'sunday' : 'weekday']) {
          availableText = "I have appointments available throughout the day.";
        } else {
          const times = slots.slice(0, 3).map(s => s.displayTime).join(', ');
          availableText = `I have ${times} available.`;
        }
        
        return `${availableText} What time works best for you?`;
      } else {
        this.customerInfo.day = null;
        return `I don't have any openings on ${dayFound}. What other day would work for you?`;
      }
    } else {
      return "What day works best for you this week?";
    }
  }
  
  async handleTimeSelection(userMessage) {
    if (!this.waitingForTimeSelection || !this.customerInfo.availableSlots.length) return null;
    
    let selectedSlot = null;
    const lower = userMessage.toLowerCase();
    
    // Time matching
    const timePatterns = [
      { pattern: /\b(morning|first)\b/i, preference: 'morning' },
      { pattern: /\b(afternoon|second|lunch)\b/i, preference: 'afternoon' },
      { pattern: /\b(\d{1,2})\s*(am|pm|o'?clock)?\b/i, preference: 'specific' }
    ];
    
    for (const {pattern, preference} of timePatterns) {
      const match = lower.match(pattern);
      if (match) {
        if (preference === 'morning') {
          selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime.includes('AM'));
        } else if (preference === 'afternoon') {
          selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime.includes('PM'));
        } else if (preference === 'specific' && match[1]) {
          const hour = parseInt(match[1]);
          selectedSlot = this.customerInfo.availableSlots.find(s => {
            const slotHour = parseInt(s.displayTime.split(':')[0]);
            return slotHour === hour || (hour < 8 && slotHour === hour + 12);
          });
        }
        break;
      }
    }
    
    if (selectedSlot) {
      this.customerInfo.selectedSlot = selectedSlot;
      this.customerInfo.specificTime = selectedSlot.displayTime;
      this.waitingForTimeSelection = false;
      this.conversationPhase = 'booking_confirmation';
      
      // Book the appointment
      const booked = await this.bookAppointment();
      
      if (booked) {
        this.customerInfo.bookingConfirmed = true;
        
        // Assign salesperson if available
        const salesperson = this.assignSalesperson();
        
        return `Perfect! You're all set for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. ${salesperson ? salesperson.name : 'One of our sales consultants'} will have the ${this.customerInfo.vehicleInterest || 'vehicle'} ready for your test drive. ${this.customerInfo.tradeIn ? "We'll also have our appraisal team ready to evaluate your trade-in. " : ""}You'll receive a confirmation email shortly!`;
      } else {
        return `Great! I have you down for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our team will contact you shortly to confirm.`;
      }
    } else {
      const times = this.customerInfo.availableSlots.slice(0, 3).map(s => s.displayTime).join(', ');
      return `I have ${times} available. Which specific time works for you?`;
    }
  }
  
  handleBookingConfirmation(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('thank') || lower.includes('perfect') || lower.includes('great')) {
      return `You're welcome! We look forward to seeing you ${this.customerInfo.day}. If you need to reschedule or have any questions, just give us a call. Have a great day!`;
    } else if (lower.includes('email') || lower.includes('phone')) {
      return "What's the best email and phone number to send your confirmation to?";
    } else {
      return "Is there anything else I can help you with today?";
    }
  }
  
  assignSalesperson() {
    if (!this.salesTeam || this.salesTeam.length === 0) return null;
    
    // Logic to assign salesperson based on specialty
    if (this.customerInfo.vehicleInterest) {
      const specialist = this.salesTeam.find(sp => 
        sp.specialties?.some(s => 
          this.customerInfo.vehicleInterest.toLowerCase().includes(s.toLowerCase())
        )
      );
      
      if (specialist) {
        this.customerInfo.preferredSalesperson = specialist.name;
        return specialist;
      }
    }
    
    // Return first available
    return this.salesTeam[0];
  }
  
  async bookAppointment() {
    try {
      if (!isCalendarInitialized() || !this.customerInfo.selectedSlot) {
        console.log('❌ Cannot book: Calendar not ready or no slot selected');
        return false;
      }
      
      const bookingDate = new Date(this.customerInfo.selectedSlot.startTime);
      
      // Generate email if we don't have one
      const placeholderEmail = this.customerInfo.email || 
        `${this.customerInfo.firstName.toLowerCase()}.${this.callId}@${this.config.companyId}.com`;
      
      const result = await autoBookAppointment(
        this.customerInfo.name,
        placeholderEmail,
        this.customerInfo.phone || 'No phone provided',
        bookingDate,
        {
          dealership: this.config.companyName,
          vehicle_interest: this.customerInfo.vehicleInterest,
          new_or_used: this.customerInfo.newOrUsed,
          trade_in: this.customerInfo.tradeIn,
          timeline: this.customerInfo.timeline,
          salesperson: this.customerInfo.preferredSalesperson,
          appointment_type: 'Test Drive',
          callId: this.callId
        }
      );
      
      console.log('📅 Test drive booking result:', result.success ? '✅ SUCCESS' : '❌ FAILED');
      return result.success;
      
    } catch (error) {
      console.error('❌ Booking exception:', error);
      return false;
    }
  }
  
  getNextDate(dayName) {
    const today = new Date();
    
    if (dayName === 'today') {
      return today;
    }
    
    if (dayName === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow;
    }
    
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayIndex = today.getDay();
    const targetIndex = days.indexOf(dayName.toLowerCase());
    
    if (targetIndex === -1) return today;
    
    let daysUntil = targetIndex - todayIndex;
    if (daysUntil <= 0) daysUntil += 7;
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate;
  }
  
  async handleClose() {
    console.log('🔌 Call ended');
    console.log(`📊 Summary:`);
    console.log(`  - Dealership: ${this.config.companyName}`);
    console.log(`  - Customer: ${this.customerInfo.firstName || 'Unknown'}`);
    console.log(`  - Phone: ${this.customerInfo.phone || 'Not captured'}`);
    console.log(`  - Vehicle Interest: ${this.customerInfo.vehicleInterest || 'Not specified'}`);
    console.log(`  - New/Used: ${this.customerInfo.newOrUsed || 'Not specified'}`);
    console.log(`  - Trade-In: ${this.customerInfo.tradeIn ? 'Yes' : 'No'}`);
    console.log(`  - Timeline: ${this.customerInfo.timeline || 'Not specified'}`);
    console.log(`  - Test Drive: ${this.customerInfo.day || 'Not scheduled'} at ${this.customerInfo.specificTime || 'No time'}`);
    console.log(`  - Booked: ${this.customerInfo.bookingConfirmed ? '✅' : '❌'}`);
    
    if (this.customerInfo.firstName) {
      await sendSchedulingPreference(
        this.customerInfo.name || this.customerInfo.firstName,
        this.customerInfo.email || '',
        this.customerInfo.phone || 'Unknown',
        this.customerInfo.day && this.customerInfo.specificTime ? 
          `Test drive ${this.customerInfo.day} at ${this.customerInfo.specificTime}` : 'Not scheduled',
        this.callId,
        {
          dealership: this.config.companyName,
          vehicle_interest: this.customerInfo.vehicleInterest,
          new_or_used: this.customerInfo.newOrUsed,
          trade_in: this.customerInfo.tradeIn,
          timeline: this.customerInfo.timeline,
          salesperson: this.customerInfo.preferredSalesperson,
          appointment_type: 'Test Drive',
          specificTime: this.customerInfo.specificTime,
          day: this.customerInfo.day,
          calendarBooked: this.customerInfo.bookingConfirmed
        }
      );
      
      console.log('✅ Test drive webhook sent');
    }
  }
}

module.exports = DealershipWebSocketHandler;
