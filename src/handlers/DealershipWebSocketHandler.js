// src/handlers/DealershipWebSocketHandler.js - FIXED CONVERSATION FLOW
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
      wantsTestDrive: null,
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
    
    // Response timing - INCREASED DELAYS
    this.responseDelay = 2500; // Increased from 1500ms to 2500ms
    this.lastResponseTime = 0;
    this.pendingResponseTimeout = null;
    this.minimumTimeBetweenResponses = 3000; // 3 seconds minimum
    
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
            
            // Calculate delay based on time since last response
            const now = Date.now();
            const timeSinceLastResponse = now - this.lastResponseTime;
            let delay = this.responseDelay;
            
            if (timeSinceLastResponse < this.minimumTimeBetweenResponses) {
              delay = this.minimumTimeBetweenResponses - timeSinceLastResponse + 500;
            }
            
            if (!this.hasGreeted && userMessage.toLowerCase().includes('hello')) {
              // Respond to initial greeting with shorter delay
              this.hasGreeted = true;
              this.conversationPhase = 'greeting';
              if (this.pendingResponseTimeout) clearTimeout(this.pendingResponseTimeout);
              this.pendingResponseTimeout = setTimeout(async () => {
                const greeting = this.generateDealershipGreeting();
                await this.sendResponse(greeting, parsed.response_id);
              }, 1000);
            } else {
              // All other messages with proper delay
              if (this.pendingResponseTimeout) clearTimeout(this.pendingResponseTimeout);
              this.pendingResponseTimeout = setTimeout(() => this.processMessage(parsed), delay);
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
    
    // Add a natural pause before sending
    await new Promise(resolve => setTimeout(resolve, 200));
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId
    }));
    
    this.lastResponseTime = Date.now();
  }
  
  async getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    switch (this.conversationPhase) {
      case 'greeting':
        return this.handleGreetingPhase(userMessage);
        
      case 'vehicle_inquiry':
        return this.handleVehicleInquiry(userMessage);
        
      case 'vehicle_selection':
        return this.handleVehicleSelection(userMessage);
        
      case 'new_or_used':
        return this.handleNewOrUsed(userMessage);
        
      case 'process_explanation':
        return this.handleProcessExplanation(userMessage);
        
      case 'trade_in':
        return this.handleTradeIn(userMessage);
        
      case 'timeline':
        return this.handleTimeline(userMessage);
        
      case 'test_drive_offer':
        return this.handleTestDriveOffer(userMessage);
        
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
    } else if (lower.includes('looking') || lower.includes('interested') || lower.includes('test drive') || lower.includes('buy')) {
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
    
    // Enhanced model detection with common variations
    const modelVariations = {
      'mustang': 'Mustang',
      'f-150': 'F-150',
      'f150': 'F-150',
      'f 150': 'F-150',
      'explorer': 'Explorer',
      'escape': 'Escape',
      'bronco': 'Bronco',
      'ranger': 'Ranger',
      'expedition': 'Expedition',
      'edge': 'Edge',
      'maverick': 'Maverick',
      'bronco sport': 'Bronco Sport'
    };
    
    // Check for model variations first
    for (const [variation, modelName] of Object.entries(modelVariations)) {
      if (lower.includes(variation)) {
        foundModel = modelName;
        break;
      }
    }
    
    // If not found, check against popular models
    if (!foundModel) {
      for (const model of popularModels) {
        if (lower.includes(model.toLowerCase())) {
          foundModel = model;
          break;
        }
      }
    }
    
    if (foundModel) {
      this.customerInfo.vehicleInterest = foundModel;
      this.conversationPhase = 'new_or_used';
      
      // Use configured script if available
      const script = this.config.scripts?.vehicleInquiry?.model_interest;
      if (script) {
        return script.replace('{model}', foundModel) + ` Are you looking for a new or used ${foundModel}?`;
      }
      return `Great choice! The ${foundModel} is one of our most popular vehicles. We have several in stock. Are you looking for a new or used ${foundModel}?`;
    } else if (lower.includes('truck')) {
      this.customerInfo.vehicleInterest = 'truck'; // Store general interest
      this.conversationPhase = 'vehicle_selection';
      return "Excellent choice! We have the F-150, Ranger, and Maverick. Which size truck works best for your needs?";
    } else if (lower.includes('suv')) {
      this.customerInfo.vehicleInterest = 'SUV'; // Store general interest
      this.conversationPhase = 'vehicle_selection';
      return "Great! We have everything from the compact Escape to the full-size Expedition. What size SUV are you looking for?";
    } else if (lower.includes('car') || lower.includes('sedan')) {
      this.customerInfo.vehicleInterest = 'car'; // Store general interest
      this.conversationPhase = 'vehicle_selection';  
      return "We have several great cars including the Mustang. Which model interests you most?";
    } else {
      // If they mention wanting to test drive or buy but don't specify
      if (lower.includes('test drive') || lower.includes('drive') || lower.includes('buy')) {
        return "I'd be happy to help! Which specific Ford model were you interested in? We have trucks like the F-150, SUVs like the Explorer, or cars like the Mustang.";
      }
      return "What type of vehicle are you interested in? We have a great selection of trucks, SUVs, and cars.";
    }
  }
  
  handleVehicleSelection(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Check for specific models mentioned after the category was selected
    const modelVariations = {
      'mustang': 'Mustang',
      'f-150': 'F-150',
      'f150': 'F-150',
      'f 150': 'F-150',
      'explorer': 'Explorer',
      'escape': 'Escape',
      'bronco': 'Bronco',
      'ranger': 'Ranger',
      'expedition': 'Expedition',
      'edge': 'Edge',
      'maverick': 'Maverick',
      'bronco sport': 'Bronco Sport',
      'compact': 'Escape',
      'mid-size': 'Edge',
      'midsize': 'Edge',
      'full-size': 'Expedition',
      'full size': 'Expedition',
      'large': 'Expedition',
      'small': 'Escape'
    };
    
    // Check for model variations
    for (const [variation, modelName] of Object.entries(modelVariations)) {
      if (lower.includes(variation)) {
        this.customerInfo.vehicleInterest = modelName;
        this.conversationPhase = 'new_or_used';
        return `Excellent choice! The ${modelName} is a fantastic vehicle. Are you looking for a new or used ${modelName}?`;
      }
    }
    
    // If they're still not specific, ask again based on their category
    if (this.customerInfo.vehicleInterest === 'truck') {
      return "Which truck are you interested in? The F-150 is our most popular full-size truck, the Ranger is perfect for those who want something smaller, and the Maverick is our newest compact truck.";
    } else if (this.customerInfo.vehicleInterest === 'SUV') {
      return "What size SUV works best for you? The Escape is great for city driving, the Edge offers more space, the Explorer is perfect for families, and the Expedition is our largest SUV.";
    } else if (this.customerInfo.vehicleInterest === 'car') {
      return "The Mustang is our iconic sports car. Are you interested in the Mustang, or were you looking for something else?";
    } else {
      // Fallback
      return "Could you tell me which specific Ford model you're interested in?";
    }
  }
  
  handleNewOrUsed(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Check if they're asking about the process
    if (lower.includes('how') && (lower.includes('process') || lower.includes('work'))) {
      this.conversationPhase = 'process_explanation';
      return this.handleProcessExplanation(userMessage);
    }
    
    if (lower.includes('new')) {
      this.customerInfo.newOrUsed = 'new';
    } else if (lower.includes('used')) {
      this.customerInfo.newOrUsed = 'used';
    } else {
      // Default to asking the question again if unclear
      return "Are you looking for a new or used " + (this.customerInfo.vehicleInterest || 'vehicle') + "?";
    }
    
    this.conversationPhase = 'trade_in';
    return "Perfect! Do you have a vehicle you'd like to trade in?";
  }
  
  handleProcessExplanation(userMessage) {
    // Explain the process and then continue
    this.conversationPhase = 'trade_in';
    return `Great question! Here's how it works: First, I'll gather some basic information about what you're looking for. Then I can schedule you for a test drive where you'll meet with one of our sales consultants. They'll show you the ${this.customerInfo.vehicleInterest || 'vehicles'}, answer all your questions, and go over pricing and financing options. The whole process is no-pressure and focused on finding the right vehicle for you. 

So, do you have a vehicle you'd like to trade in?`;
  }
  
  handleTradeIn(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('yeah')) {
      this.customerInfo.tradeIn = true;
      this.conversationPhase = 'timeline';
      return "Great! We'll make sure to have our appraisal team ready. When are you looking to make a purchase - this week, this month, or just starting your research?";
    } else if (lower.includes('no') || lower.includes("don't") || lower.includes("do not")) {
      this.customerInfo.tradeIn = false;
      this.conversationPhase = 'timeline';
      return "No problem! When are you looking to make a purchase - this week, this month, or just starting your research?";
    } else {
      // Handle unclear responses
      return "Do you have a vehicle you'd like to trade in? Just say yes or no.";
    }
  }
  
  handleTimeline(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('this week') || lower.includes('soon') || lower.includes('asap')) {
      this.customerInfo.timeline = 'this week';
    } else if (lower.includes('this month') || lower.includes('month')) {
      this.customerInfo.timeline = 'this month';
    } else if (lower.includes('research') || lower.includes('looking') || lower.includes('browsing')) {
      this.customerInfo.timeline = 'researching';
    } else {
      // Default to researching for unclear responses
      this.customerInfo.timeline = 'researching';
    }
    
    // Now offer test drive
    this.conversationPhase = 'test_drive_offer';
    return `Perfect! Would you like to schedule a test drive for the ${this.customerInfo.vehicleInterest || 'vehicle you\'re interested in'}? It's the best way to see if it's the right fit for you.`;
  }
  
  handleTestDriveOffer(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('yeah') || lower.includes('sure') || lower.includes('ok') || lower.includes('sounds good') || lower.includes('that would') || lower.includes('yep') || lower.includes("let's do")) {
      this.customerInfo.wantsTestDrive = true;
      this.conversationPhase = 'name';
      return "Excellent! Let me get that scheduled for you. What's your first name?";
    } else if (lower.includes('no') || lower.includes('not')) {
      this.customerInfo.wantsTestDrive = false;
      return "No problem! Feel free to browse our inventory online, and if you change your mind or have any questions, just give us a call. Is there anything else I can help you with today?";
    } else {
      // Unclear response
      return "Would you like me to schedule a test drive for you? It's a great way to experience the vehicle firsthand.";
    }
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
        `the ${this.customerInfo.vehicleInterest}` : 'the vehicle';
      
      return `Nice to meet you, ${extractedName}! I'd love to get you scheduled for a test drive of ${vehicleText}. ${this.customerInfo.tradeIn ? 'We\'ll also have our appraisal team ready to evaluate your trade-in. ' : ''}What day works best for you?`;
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
      
      // Get available slots
      const targetDate = this.getNextDate(dayFound);
      this.customerInfo.bookingDate = targetDate;
      
      console.log(`📅 Getting slots for ${dayFound}:`, targetDate.toISOString());
      const slots = await getAvailableTimeSlots(targetDate);
      
      if (slots.length > 0) {
        this.conversationPhase = 'time_selection';
        this.customerInfo.availableSlots = slots;
        this.waitingForTimeSelection = true;
        
        // Get morning and afternoon slots
        const morningSlots = slots.filter(s => {
          const hour = parseInt(s.displayTime.split(':')[0]);
          const isPM = s.displayTime.includes('PM');
          return !isPM || (isPM && hour === 12);
        });
        
        const afternoonSlots = slots.filter(s => {
          const hour = parseInt(s.displayTime.split(':')[0]);
          const isPM = s.displayTime.includes('PM');
          return isPM && hour !== 12;
        });
        
        // Build response with specific times
        let response = `Great! For ${this.customerInfo.day} I have `;
        
        if (morningSlots.length > 0 && afternoonSlots.length > 0) {
          // Offer both morning and afternoon options
          const morningTime = morningSlots[0].displayTime;
          const afternoonTime = afternoonSlots[0].displayTime;
          response += `${morningTime} in the morning or ${afternoonTime} in the afternoon. Which works better for you?`;
        } else if (morningSlots.length > 0) {
          // Only morning slots available
          const times = morningSlots.slice(0, 3).map(s => s.displayTime);
          if (times.length === 1) {
            response += `${times[0]} available. Does that work for you?`;
          } else if (times.length === 2) {
            response += `${times[0]} or ${times[1]} available. Which time works best?`;
          } else {
            response += `${times[0]}, ${times[1]}, or ${times[2]} available. Which time works best?`;
          }
        } else if (afternoonSlots.length > 0) {
          // Only afternoon slots available
          const times = afternoonSlots.slice(0, 3).map(s => s.displayTime);
          if (times.length === 1) {
            response += `${times[0]} available. Does that work for you?`;
          } else if (times.length === 2) {
            response += `${times[0]} or ${times[1]} available. Which time works best?`;
          } else {
            response += `${times[0]}, ${times[1]}, or ${times[2]} available. Which time works best?`;
          }
        }
        
        return response;
      } else {
        // Reset state and stay in scheduling phase
        this.customerInfo.day = null;
        this.customerInfo.bookingDate = null;
        // Stay in scheduling phase instead of moving to time_selection
        this.conversationPhase = 'scheduling';
        return `I don't have any openings on ${dayFound}. What other day would work for you?`;
      }
    } else {
      return "What day works best for you this week?";
    }
  }
  
  async handleTimeSelection(userMessage) {
    // If we're not actually waiting for time selection, try scheduling again
    if (!this.waitingForTimeSelection || !this.customerInfo.availableSlots.length) {
      // If the user said a day while we're in time_selection incorrectly, handle it
      const lower = userMessage.toLowerCase();
      const days = ['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayFound = days.find(day => lower.includes(day));
      
      if (dayFound) {
        this.conversationPhase = 'scheduling';
        return await this.handleScheduling(userMessage);
      }
      
      return "What day works best for you?";
    }
    
    let selectedSlot = null;
    const lower = userMessage.toLowerCase();
    
    // Time matching patterns
    const timePatterns = [
      { pattern: /\b(morning|first)\b/i, preference: 'morning' },
      { pattern: /\b(afternoon|second|lunch)\b/i, preference: 'afternoon' },
      { pattern: /\b(\d{1,2})\s*(am|pm|o'?clock)?\b/i, preference: 'specific' },
      { pattern: /\b(early)\b/i, preference: 'early' },
      { pattern: /\b(late|later)\b/i, preference: 'late' }
    ];
    
    for (const {pattern, preference} of timePatterns) {
      const match = lower.match(pattern);
      if (match) {
        if (preference === 'morning' || preference === 'early') {
          // Get the earliest morning slot
          selectedSlot = this.customerInfo.availableSlots.find(s => {
            const hour = parseInt(s.displayTime.split(':')[0]);
            const isPM = s.displayTime.includes('PM');
            return !isPM || (isPM && hour === 12);
          });
        } else if (preference === 'afternoon' || preference === 'late') {
          // Get an afternoon slot
          selectedSlot = this.customerInfo.availableSlots.find(s => {
            const hour = parseInt(s.displayTime.split(':')[0]);
            const isPM = s.displayTime.includes('PM');
            return isPM && hour !== 12;
          });
        } else if (preference === 'specific' && match[1]) {
          const hour = parseInt(match[1]);
          const isPM = match[2] && match[2].toLowerCase().includes('p');
          const isAM = match[2] && match[2].toLowerCase().includes('a');
          
          selectedSlot = this.customerInfo.availableSlots.find(s => {
            const slotHour = parseInt(s.displayTime.split(':')[0]);
            const slotIsPM = s.displayTime.includes('PM');
            
            // Direct hour match
            if (slotHour === hour) {
              // If AM/PM specified, must match
              if (isAM && !slotIsPM) return true;
              if (isPM && slotIsPM) return true;
              // If no AM/PM specified, assume business hours context
              if (!isAM && !isPM) return true;
            }
            
            // Handle 12-hour conversion
            if (hour < 8 && slotHour === hour + 12 && slotIsPM) {
              return true;
            }
            
            return false;
          });
        }
        break;
      }
    }
    
    // If no slot selected, check for "yes" or confirmation to first available
    if (!selectedSlot && (lower.includes('yes') || lower.includes('sure') || lower.includes('ok') || lower.includes('that works'))) {
      selectedSlot = this.customerInfo.availableSlots[0];
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
      // Offer the times again with more guidance
      const morningSlots = this.customerInfo.availableSlots.filter(s => !s.displayTime.includes('PM') || s.displayTime.startsWith('12'));
      const afternoonSlots = this.customerInfo.availableSlots.filter(s => s.displayTime.includes('PM') && !s.displayTime.startsWith('12'));
      
      if (morningSlots.length > 0 && afternoonSlots.length > 0) {
        return `I have ${morningSlots[0].displayTime} in the morning or ${afternoonSlots[0].displayTime} in the afternoon. Just let me know which you prefer - morning or afternoon?`;
      } else {
        const times = this.customerInfo.availableSlots.slice(0, 3).map(s => s.displayTime).join(', ');
        return `I have ${times} available. Which specific time works for you?`;
      }
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
    console.log(`  - Wants Test Drive: ${this.customerInfo.wantsTestDrive === null ? 'Not asked' : this.customerInfo.wantsTestDrive ? 'Yes' : 'No'}`);
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
          wants_test_drive: this.customerInfo.wantsTestDrive,
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
