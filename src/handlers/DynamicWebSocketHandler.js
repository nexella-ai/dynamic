// src/handlers/DynamicWebSocketHandler.js - FAST RESPONSE WITH PROPER BOOKING
const configLoader = require('../services/config/ConfigurationLoader');
const { 
  autoBookAppointment, 
  isCalendarInitialized, 
  initializeCalendarService,
  getAvailableTimeSlots 
} = require('../services/calendar/CalendarHelpers');
const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');

class DynamicWebSocketHandler {
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
      phone: this.req.headers['x-caller-phone'] || null,
      email: '',
      // Roofing specific info
      propertyType: null,
      roofAge: null,
      issue: null,
      urgency: null,
      insuranceClaim: null,
      // Scheduling
      day: null,
      specificTime: null,
      availableSlots: [],
      selectedSlot: null,
      bookingConfirmed: false
    };
    
    // Conversation state
    this.conversationPhase = 'waiting';
    this.hasGreeted = false;
    this.waitingForTimeSelection = false;
    
    // FAST response - only 500ms delay
    this.responseDelay = 500;
    this.pendingResponseTimeout = null;
    
    // Initialize ASAP
    this.initialize();
  }
  
  async initialize() {
    try {
      // Load config and init calendar in parallel for speed
      const [configResult] = await Promise.all([
        configLoader.loadCompanyConfig(this.companyId),
        isCalendarInitialized() ? Promise.resolve() : initializeCalendarService()
      ]);
      
      this.config = configResult;
      console.log(`🏢 ${this.config.companyName} ready`);
      console.log(`📅 Calendar: ${isCalendarInitialized() ? '✅' : '❌'}`);
      
      // Set up message handler
      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.interaction_type === 'response_required') {
            // IMMEDIATE response for hello
            const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
            console.log(`🗣️ User: ${userMessage}`);
            
            if (!this.hasGreeted && userMessage.toLowerCase().includes('hello')) {
              // Respond IMMEDIATELY to hello
              this.hasGreeted = true;
              this.conversationPhase = 'greeting';
              await this.sendResponse("Hey there! Mike from Half Price Roof. Thanks for calling - how's your day going?", parsed.response_id);
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
  
  async processMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    this.messageCount++;
    
    // Get response based on phase
    const response = await this.getResponse(userMessage);
    if (response) {
      await this.sendResponse(response, parsed.response_id);
    }
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 Mike: ${content}`);
    
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
        this.conversationPhase = 'need';
        if (lower.includes('good') || lower.includes('fine') || lower.includes('ok')) {
          return "That's great! So what's happening with your roof? Need a repair, replacement, or just want a free inspection?";
        } else if (lower.includes('not') || lower.includes('bad')) {
          return "Sorry to hear that. Well, let me help make your day better - what's going on with your roof?";
        } else {
          // Generic/unclear response like "Pepper"
          return "I appreciate you taking the time. So what's going on with your roof - any leaks, damage, or just time for a replacement?";
        }
        
      case 'need':
        if (lower.includes('replac')) {
          this.customerInfo.issue = 'replacement';
          this.conversationPhase = 'property';
          return "Full roof replacement - got it. Is this for your home or a commercial property?";
        } else if (lower.includes('leak')) {
          this.customerInfo.issue = 'leak';
          this.conversationPhase = 'property';
          return "Oh no, a leak! We'll get that fixed fast. Is this at your home?";
        } else if (lower.includes('inspect')) {
          this.customerInfo.issue = 'inspection';
          this.conversationPhase = 'property';
          return "Smart to get it checked! Is this for your home or business?";
        } else {
          return "I can help with repairs, replacements, or free inspections. Which one do you need?";
        }
        
      case 'property':
        if (lower.includes('home') || lower.includes('house') || lower.includes('yes')) {
          this.customerInfo.propertyType = 'residential';
          this.conversationPhase = 'urgency';
          return "Perfect. How soon do you need someone out there - is this urgent?";
        } else if (lower.includes('business') || lower.includes('commercial')) {
          this.customerInfo.propertyType = 'commercial';
          this.conversationPhase = 'urgency';
          return "We handle lots of commercial properties. How urgent is this?";
        } else {
          return "Just to clarify - is this for a home or business property?";
        }
        
      case 'urgency':
        if (lower.includes('asap') || lower.includes('urgent') || lower.includes('soon') || 
            lower.includes('emergency') || lower.includes('yes')) {
          this.customerInfo.urgency = 'urgent';
          this.conversationPhase = 'age';
          return "We'll prioritize this. Quick question - about how old is your roof?";
        } else if (lower.includes('not') || lower.includes('planning')) {
          this.customerInfo.urgency = 'planning';
          this.conversationPhase = 'age';
          return "Good to plan ahead! Do you know roughly how old your roof is?";
        } else {
          this.customerInfo.urgency = 'soon';
          this.conversationPhase = 'age';
          return "Got it. About how old is your current roof?";
        }
        
      case 'age':
        // Extract age info
        if (lower.includes('thirty') || lower.includes('30')) {
          this.customerInfo.roofAge = '30 years';
        } else if (lower.includes('twenty') || lower.includes('20')) {
          this.customerInfo.roofAge = '20 years';
        } else if (lower.includes('old')) {
          this.customerInfo.roofAge = 'very old';
        } else {
          this.customerInfo.roofAge = userMessage;
        }
        
        this.conversationPhase = 'name';
        return "Thanks! Let me get you on the schedule. What's your first name?";
        
      case 'name':
        // Better name extraction
        let extractedName = null;
        
        // Check for "It's [Name]" pattern
        const itsPattern = /it'?s?\s+([A-Z][a-z]+)/i;
        const itsMatch = userMessage.match(itsPattern);
        if (itsMatch) {
          extractedName = itsMatch[1];
        } else {
          // Check other patterns
          const namePatterns = [
            /my name is\s+([A-Z][a-z]+)/i,
            /i'?m\s+([A-Z][a-z]+)/i,
            /this is\s+([A-Z][a-z]+)/i,
            /^([A-Z][a-z]+)$/  // Just the name
          ];
          
          for (const pattern of namePatterns) {
            const match = userMessage.match(pattern);
            if (match) {
              extractedName = match[1];
              break;
            }
          }
        }
        
        if (extractedName) {
          this.customerInfo.firstName = extractedName;
          this.customerInfo.name = extractedName;
          this.conversationPhase = 'scheduling';
          
          if (this.customerInfo.urgency === 'urgent') {
            return `Got it, ${extractedName}! Since this is urgent, I can get someone there today or tomorrow. Which works better?`;
          } else {
            return `Perfect, ${extractedName}! Let me check what we have available. What day works best this week?`;
          }
        } else {
          return "I didn't catch that - could you tell me your first name please?";
        }
        
      case 'scheduling':
        const days = ['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        const dayFound = days.find(day => lower.includes(day));
        
        if (dayFound) {
          this.customerInfo.day = dayFound.charAt(0).toUpperCase() + dayFound.slice(1);
          this.conversationPhase = 'time_selection';
          
          // Get available slots
          const targetDate = this.getNextDate(dayFound);
          const slots = await getAvailableTimeSlots(targetDate);
          
          if (slots.length > 0) {
            this.customerInfo.availableSlots = slots;
            this.waitingForTimeSelection = true;
            
            // Offer morning and afternoon options
            const morningSlots = slots.filter(s => s.displayTime.includes('AM'));
            const afternoonSlots = slots.filter(s => s.displayTime.includes('PM') && !s.displayTime.startsWith('12'));
            
            if (morningSlots.length && afternoonSlots.length) {
              return `Great! For ${this.customerInfo.day} I have ${morningSlots[0].displayTime} in the morning or ${afternoonSlots[0].displayTime} in the afternoon. Which works better?`;
            } else {
              const times = slots.slice(0, 3).map(s => s.displayTime).join(', ');
              return `For ${this.customerInfo.day} I have these times available: ${times}. Which works best?`;
            }
          } else {
            this.customerInfo.day = null;
            return `I don't have any openings ${dayFound}. What about the next day?`;
          }
        } else {
          return "What day works best for you - today, tomorrow, or later this week?";
        }
        
      case 'time_selection':
        if (!this.waitingForTimeSelection) return null;
        
        let selectedSlot = null;
        
        // Check for specific time mentions
        if (lower.includes('1 pm') || lower.includes('one pm') || lower.includes('1:00')) {
          selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime === '1:00 PM');
        } else if (lower.includes('10 am') || lower.includes('ten am') || lower.includes('10:00')) {
          selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime === '10:00 AM');
        } else if (lower.includes('morning')) {
          selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime.includes('AM'));
        } else if (lower.includes('afternoon')) {
          selectedSlot = this.customerInfo.availableSlots.find(s => 
            s.displayTime.includes('PM') && !s.displayTime.startsWith('12')
          );
        } else {
          // Try to match any number mentioned
          const timeMatch = userMessage.match(/(\d+)/);
          if (timeMatch) {
            const hour = timeMatch[1];
            selectedSlot = this.customerInfo.availableSlots.find(s => 
              s.displayTime.startsWith(hour + ':') || s.displayTime.startsWith(hour + ' ')
            );
          }
        }
        
        if (selectedSlot) {
          this.customerInfo.selectedSlot = selectedSlot;
          this.customerInfo.specificTime = selectedSlot.displayTime;
          this.waitingForTimeSelection = false;
          this.conversationPhase = 'booking';
          
          // Book immediately
          const booked = await this.bookAppointment();
          if (booked) {
            this.customerInfo.bookingConfirmed = true;
            return `Perfect ${this.customerInfo.firstName}! You're all set for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. We'll call 30 minutes before we arrive. Any questions?`;
          } else {
            return `Great! I've got you down for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our office will confirm shortly. Sound good?`;
          }
        } else {
          // Couldn't understand time selection
          const times = this.customerInfo.availableSlots.slice(0, 3).map(s => s.displayTime).join(', ');
          return `I have ${times} available. Which specific time works for you?`;
        }
        
      case 'booking':
        if (lower.includes('question')) {
          return "Sure, what would you like to know?";
        } else if (lower.includes('email')) {
          return "What's your email address for the confirmation?";
        } else if (lower.includes('@')) {
          this.customerInfo.email = userMessage;
          return "Perfect! You'll get a confirmation email shortly. Have a great day!";
        } else {
          return "Sounds good! We'll see you then. Have a great day!";
        }
        
      default:
        return null;
    }
  }
  
  async bookAppointment() {
    try {
      if (!isCalendarInitialized() || !this.customerInfo.selectedSlot) {
        return false;
      }
      
      const bookingDate = new Date(this.customerInfo.selectedSlot.startTime);
      
      const result = await autoBookAppointment(
        this.customerInfo.name,
        this.customerInfo.email || `${this.customerInfo.firstName.toLowerCase()}@halfpriceroof.com`,
        this.customerInfo.phone || '',
        bookingDate,
        {
          service: this.customerInfo.issue,
          propertyType: this.customerInfo.propertyType,
          urgency: this.customerInfo.urgency,
          roofAge: this.customerInfo.roofAge,
          company: this.config.companyName
        }
      );
      
      return result.success;
    } catch (error) {
      console.error('❌ Booking error:', error);
      return false;
    }
  }
  
  getNextDate(dayName) {
    const today = new Date();
    
    if (dayName === 'today') return today;
    if (dayName === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow;
    }
    
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayIndex = today.getDay();
    const targetIndex = days.indexOf(dayName);
    
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
    console.log(`  - Customer: ${this.customerInfo.firstName}`);
    console.log(`  - Issue: ${this.customerInfo.issue}`);
    console.log(`  - Scheduled: ${this.customerInfo.day} at ${this.customerInfo.specificTime}`);
    console.log(`  - Booked: ${this.customerInfo.bookingConfirmed ? '✅' : '❌'}`);
    
    if (this.customerInfo.firstName && this.customerInfo.issue) {
      await sendSchedulingPreference(
        this.customerInfo.name,
        this.customerInfo.email || '',
        this.customerInfo.phone || 'Unknown',
        this.customerInfo.day && this.customerInfo.specificTime ? 
          `${this.customerInfo.day} at ${this.customerInfo.specificTime}` : 
          'Not scheduled',
        this.callId,
        {
          service: this.customerInfo.issue,
          propertyType: this.customerInfo.propertyType,
          urgency: this.customerInfo.urgency,
          roofAge: this.customerInfo.roofAge,
          company: this.config.companyName,
          calendarBooked: this.customerInfo.bookingConfirmed
        }
      );
    }
  }
}

module.exports = DynamicWebSocketHandler;
