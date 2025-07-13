// src/handlers/DynamicWebSocketHandler.js - ENHANCED WITH BETTER LISTENING & TIME SELECTION
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
    
    // Track conversation with enhanced discovery
    this.messageCount = 0;
    this.customerInfo = {
      name: null,
      firstName: null,
      phone: this.req.headers['x-caller-phone'] || null,
      email: '', // Will need to ask for this for calendar invite
      // Roofing specific info
      propertyType: null,      // residential/commercial
      roofAge: null,          // how old is the roof
      issue: null,            // leak, damage, replacement, inspection
      urgency: null,          // emergency, this week, planning
      insuranceClaim: null,   // yes/no/maybe
      propertyAddress: null,  // for accurate scheduling
      // Scheduling
      day: null,
      specificTime: null,     // Actual time like "9 AM"
      timePreference: null,   // morning/afternoon
      availableSlots: [],     // Available calendar slots
      selectedSlot: null,     // The chosen slot
      readyToSchedule: false
    };
    
    // Discovery questions tracker
    this.discoveryPhase = 'greeting'; // greeting -> need -> details -> scheduling -> time_selection -> booking
    this.questionsAsked = {
      need: false,
      propertyType: false,
      urgency: false,
      roofAge: false,
      insuranceClaim: false,
      address: false,
      email: false,
      specificTime: false
    };
    
    // Response cache to prevent repeats
    this.lastResponse = null;
    this.lastUserMessage = null;
    
    // Add response timing control
    this.responseDelay = 1500; // Wait 1.5 seconds before responding
    this.isWaitingToRespond = false;
    
    // Initialize immediately
    this.initialize();
  }
  
  async initialize() {
    try {
      // Ensure calendar is initialized
      if (!isCalendarInitialized()) {
        console.log('📅 Initializing calendar service...');
        await initializeCalendarService();
      }
      
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      console.log(`🏢 ${this.config.companyName} ready`);
      console.log(`📅 Calendar status: ${isCalendarInitialized() ? 'READY ✅' : 'NOT READY ❌'}`);
      
      // Set up handlers
      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.interaction_type === 'response_required') {
            await this.handleIncomingMessage(parsed);
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
  
  async handleIncomingMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    console.log(`🗣️ User: ${userMessage}`);
    
    // Cancel any pending response
    if (this.pendingResponseTimeout) {
      clearTimeout(this.pendingResponseTimeout);
    }
    
    // Store the message and wait a bit for them to finish speaking
    this.lastIncomingMessage = userMessage;
    this.lastIncomingParsed = parsed;
    
    // Wait before responding to let them finish their thought
    this.pendingResponseTimeout = setTimeout(async () => {
      await this.respond(this.lastIncomingParsed);
    }, this.responseDelay);
  }
  
  async respond(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    
    // Prevent responding to the same message twice
    if (userMessage === this.lastUserMessage) {
      console.log('🚫 Duplicate message ignored');
      return;
    }
    this.lastUserMessage = userMessage;
    
    // Increment message count
    this.messageCount++;
    
    // Get response based on discovery phase
    let response = await this.getResponse(userMessage);
    
    // Send immediately if we have a response
    if (response && response !== this.lastResponse) {
      console.log(`🤖 Mike: ${response}`);
      this.lastResponse = response;
      
      this.ws.send(JSON.stringify({
        content: response,
        content_complete: true,
        actions: [],
        response_id: parsed.response_id
      }));
    }
  }
  
  async getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Phase 1: Initial Greeting
    if (this.messageCount === 1) {
      this.discoveryPhase = 'greeting';
      return "Hey! Mike from Half Price Roof here. How's it going today?";
    }
    
    // Phase 2: Acknowledge greeting and ask about need
    if (this.discoveryPhase === 'greeting' && this.messageCount === 2) {
      this.discoveryPhase = 'need';
      if (lower.includes('good') || lower.includes('fine') || lower.includes('well')) {
        return "Awesome! So what's going on with your roof? Are you dealing with a leak, need a replacement, or just looking for an inspection?";
      } else if (lower.includes('how') && lower.includes('going')) {
        // They echoed the question back
        return "I'm doing great, thanks for asking! So what can I help you with today - is your roof giving you trouble?";
      } else {
        return "I hear you. Well, I'm here to help with any roofing needs. What's going on with your roof?";
      }
    }
    
    // Phase 3: Capture their need and ask property type
    if (this.discoveryPhase === 'need' && !this.customerInfo.issue) {
      if (lower.includes('replac')) {
        this.customerInfo.issue = 'replacement';
        this.discoveryPhase = 'details';
        return "Got it, full roof replacement. Is this for your home or a commercial property?";
      } else if (lower.includes('leak') || lower.includes('water')) {
        this.customerInfo.issue = 'leak';
        this.discoveryPhase = 'details';
        return "Oh no, a leak! Those need quick attention. Is this at your home or a business?";
      } else if (lower.includes('inspect') || lower.includes('check')) {
        this.customerInfo.issue = 'inspection';
        this.discoveryPhase = 'details';
        return "Smart to get it inspected! Is this for a residential or commercial property?";
      } else if (lower.includes('damage') || lower.includes('storm')) {
        this.customerInfo.issue = 'storm damage';
        this.discoveryPhase = 'details';
        return "Storm damage can be serious. Is this your home or a commercial building?";
      } else {
        // They said something else, probe more
        return "I can help with repairs, replacements, or free inspections. Which one are you looking for?";
      }
    }
    
    // Phase 4: Get property type and ask urgency
    if (this.discoveryPhase === 'details' && !this.customerInfo.propertyType) {
      if (lower.includes('home') || lower.includes('house') || lower.includes('residential') || 
          lower.includes('my') || lower === 'yes') {
        this.customerInfo.propertyType = 'residential';
        this.questionsAsked.propertyType = true;
        
        if (this.customerInfo.issue === 'leak') {
          return "I'll make sure we get someone out quickly. Is water actively coming in right now, or is it more of a slow leak?";
        } else {
          return "Perfect. How urgent is this - do you need someone out right away or are you planning ahead?";
        }
      } else if (lower.includes('commercial') || lower.includes('business') || lower.includes('building')) {
        this.customerInfo.propertyType = 'commercial';
        this.questionsAsked.propertyType = true;
        return "We handle a lot of commercial properties. How urgent is this for your business?";
      }
    }
    
    // Phase 5: Get urgency and ask about roof age
    if (!this.customerInfo.urgency && this.questionsAsked.propertyType) {
      if (lower.includes('asap') || lower.includes('soon as possible') || lower.includes('right away') || 
          lower.includes('emergency') || lower.includes('active') || lower.includes('coming in')) {
        this.customerInfo.urgency = 'emergency';
        this.questionsAsked.urgency = true;
        return "We have emergency crews available. Do you know roughly how old your roof is?";
      } else if (lower.includes('week') || lower.includes('soon')) {
        this.customerInfo.urgency = 'this week';
        this.questionsAsked.urgency = true;
        return "We can definitely get someone out this week. About how old is your current roof?";
      } else if (lower.includes('planning') || lower.includes('quote') || lower.includes('slow')) {
        this.customerInfo.urgency = 'planning';
        this.questionsAsked.urgency = true;
        return "Good to plan ahead! Do you know approximately how old your roof is?";
      }
    }
    
    // Phase 6: Get roof age and ask about insurance
    if (!this.customerInfo.roofAge && this.questionsAsked.urgency) {
      // Try to extract age from response - handle multi-part responses
      const ageMatch = lower.match(/(\d+)\s*(year|yr)/);
      const thirtyMatch = lower.match(/thirty|30/);
      
      if (ageMatch) {
        this.customerInfo.roofAge = `${ageMatch[1]} years`;
      } else if (thirtyMatch) {
        this.customerInfo.roofAge = '30+ years';
      } else if (lower.includes('old')) {
        // If they just say "old" or "pretty old", check if there's more context
        if (lower.includes('least') && (lower.includes('thirty') || lower.includes('30'))) {
          this.customerInfo.roofAge = '30+ years';
        } else {
          this.customerInfo.roofAge = 'very old';
        }
      } else if (lower.includes('new') || lower.includes('recent')) {
        this.customerInfo.roofAge = 'less than 5 years';
      } else if (lower.includes("don't know") || lower.includes('not sure')) {
        this.customerInfo.roofAge = 'unknown';
      } else {
        // Assume they gave a non-specific answer
        this.customerInfo.roofAge = 'not specified';
      }
      
      this.questionsAsked.roofAge = true;
      
      if (this.customerInfo.issue === 'storm damage' || this.customerInfo.issue === 'leak') {
        return "Thanks. Are you planning to file an insurance claim for this?";
      } else {
        // Skip insurance question for regular replacements/inspections
        this.questionsAsked.insuranceClaim = true;
        this.customerInfo.insuranceClaim = 'N/A';
        return "Great! Now let me check our schedule. What's your first name for the appointment?";
      }
    }
    
    // Phase 7: Get insurance info and ask for name
    if (!this.customerInfo.insuranceClaim && this.questionsAsked.roofAge) {
      if (lower.includes('yes') || lower.includes('file') || lower.includes('claim')) {
        this.customerInfo.insuranceClaim = 'yes';
        return "We work with all insurance companies and can help with that process. What's your first name for the appointment?";
      } else if (lower.includes('no') || lower.includes('not')) {
        this.customerInfo.insuranceClaim = 'no';
        return "No problem, we have great cash pricing too. What's your first name?";
      } else if (lower.includes('maybe') || lower.includes('not sure')) {
        this.customerInfo.insuranceClaim = 'maybe';
        return "We can help you figure that out during the inspection. What's your first name?";
      }
    }
    
    // Phase 8: CRITICAL - Better name capture
    if (!this.customerInfo.firstName && 
        (this.questionsAsked.insuranceClaim || this.questionsAsked.roofAge)) {
      // Enhanced name extraction
      const nameMatch = userMessage.match(/(?:my name is |i'm |i am |it's |this is |call me )?([A-Z][a-z]+)/);
      
      if (nameMatch) {
        this.customerInfo.firstName = nameMatch[1];
        this.customerInfo.name = nameMatch[1];
        this.discoveryPhase = 'scheduling';
        
        // Personalized response based on urgency
        if (this.customerInfo.urgency === 'emergency') {
          return `Thanks ${this.customerInfo.firstName}! Let me get our emergency crew scheduled. We can have someone there today or tomorrow. Which works better?`;
        } else {
          return `Perfect, ${this.customerInfo.firstName}! I can get someone out to take a look. What day works best for you this week?`;
        }
      } else {
        // Couldn't extract name, ask more directly
        return "Sorry, I didn't catch that. What's your first name?";
      }
    }
    
    // Phase 9: Scheduling - Get the day
    if (this.discoveryPhase === 'scheduling' && !this.customerInfo.day) {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow'];
      const dayFound = days.find(day => lower.includes(day));
      
      if (dayFound) {
        this.customerInfo.day = dayFound.charAt(0).toUpperCase() + dayFound.slice(1);
        this.discoveryPhase = 'time_selection';
        
        // Check available times for that day
        const targetDate = this.getNextDate(this.customerInfo.day);
        const availableSlots = await getAvailableTimeSlots(targetDate);
        
        if (availableSlots.length > 0) {
          this.customerInfo.availableSlots = availableSlots;
          
          // Offer specific times
          const morningSlots = availableSlots.filter(s => parseInt(s.displayTime) < 12);
          const afternoonSlots = availableSlots.filter(s => parseInt(s.displayTime) >= 12);
          
          if (morningSlots.length > 0 && afternoonSlots.length > 0) {
            return `Great! For ${this.customerInfo.day}, I have ${morningSlots[0].displayTime} or ${afternoonSlots[0].displayTime} available. Which time works better for you?`;
          } else if (morningSlots.length > 0) {
            return `For ${this.customerInfo.day}, I have ${morningSlots[0].displayTime} available in the morning. Does that work for you?`;
          } else if (afternoonSlots.length > 0) {
            return `For ${this.customerInfo.day}, I have ${afternoonSlots[0].displayTime} available in the afternoon. Does that work for you?`;
          }
        } else {
          // No slots available that day
          this.customerInfo.day = null;
          return `I don't have any openings on ${dayFound}. How about the following day?`;
        }
      } else {
        return "What day works best for you this week?";
      }
    }
    
    // Phase 10: Get specific time selection
    if (this.discoveryPhase === 'time_selection' && this.customerInfo.day && !this.customerInfo.specificTime) {
      // Look for specific times mentioned
      const timeMatch = userMessage.match(/(\d{1,2})\s*(am|pm|o'clock|:)/i);
      const morningMatch = lower.includes('morning') || (lower.includes('am') && !timeMatch);
      const afternoonMatch = lower.includes('afternoon') || (lower.includes('pm') && !timeMatch);
      
      if (timeMatch) {
        // User specified a time
        const hour = parseInt(timeMatch[1]);
        const isPM = timeMatch[2] && timeMatch[2].toLowerCase().includes('pm');
        
        // Find matching slot
        const matchedSlot = this.customerInfo.availableSlots.find(slot => {
          const slotHour = parseInt(slot.displayTime);
          return (isPM && slotHour === hour && slot.displayTime.includes('PM')) ||
                 (!isPM && slotHour === hour && slot.displayTime.includes('AM'));
        });
        
        if (matchedSlot) {
          this.customerInfo.specificTime = matchedSlot.displayTime;
          this.customerInfo.selectedSlot = matchedSlot;
          this.customerInfo.readyToSchedule = true;
          return await this.confirmAndBook();
        } else {
          // Time not available
          return `I don't have ${hour}${isPM ? ' PM' : ' AM'} available. Would any of these times work instead: ${this.customerInfo.availableSlots.map(s => s.displayTime).join(', ')}?`;
        }
      } else if (morningMatch || afternoonMatch) {
        // User said morning/afternoon
        const relevantSlots = this.customerInfo.availableSlots.filter(s => 
          morningMatch ? s.displayTime.includes('AM') : s.displayTime.includes('PM')
        );
        
        if (relevantSlots.length === 1) {
          this.customerInfo.specificTime = relevantSlots[0].displayTime;
          this.customerInfo.selectedSlot = relevantSlots[0];
          this.customerInfo.readyToSchedule = true;
          return await this.confirmAndBook();
        } else if (relevantSlots.length > 1) {
          // Need to be more specific
          return `I have ${relevantSlots.map(s => s.displayTime).join(' or ')} available ${morningMatch ? 'in the morning' : 'in the afternoon'}. Which specific time works best?`;
        } else {
          return `I don't have any ${morningMatch ? 'morning' : 'afternoon'} slots on ${this.customerInfo.day}. Would another time work?`;
        }
      } else if (lower.includes('first') || lower.includes('earliest')) {
        // They want the first available
        this.customerInfo.specificTime = this.customerInfo.availableSlots[0].displayTime;
        this.customerInfo.selectedSlot = this.customerInfo.availableSlots[0];
        this.customerInfo.readyToSchedule = true;
        return await this.confirmAndBook();
      } else if (lower.includes('any') || lower.includes('either') || lower.includes('work')) {
        // They're flexible, book the first slot
        this.customerInfo.specificTime = this.customerInfo.availableSlots[0].displayTime;
        this.customerInfo.selectedSlot = this.customerInfo.availableSlots[0];
        this.customerInfo.readyToSchedule = true;
        return await this.confirmAndBook();
      } else {
        // Ask for clarification on specific time
        return `What specific time works best for you? I have ${this.customerInfo.availableSlots.slice(0, 3).map(s => s.displayTime).join(', ')} available.`;
      }
    }
    
    // Phase 11: Handle questions about timing after booking
    if (this.customerInfo.readyToSchedule) {
      if (lower.includes('what time') || lower.includes('at what time')) {
        return `Your appointment is scheduled for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our inspector will call 30 minutes before arriving.`;
      } else if (lower.includes('sounds good') || lower.includes('yes') || lower.includes('perfect') || 
          lower.includes('great') || lower.includes('ok')) {
        return "Excellent! You're all set. We'll send you a confirmation and our inspector will call 30 minutes before arrival. Have a great day!";
      } else if (lower.includes('email')) {
        this.questionsAsked.email = true;
        return "Sure! What email should I send the confirmation to?";
      } else if (lower.includes('no') || lower.includes('actually') || lower.includes('cancel')) {
        return "No problem! What would work better for you?";
      } else if (this.questionsAsked.email && lower.includes('@')) {
        // They provided an email
        this.customerInfo.email = userMessage.trim();
        return "Perfect! I've added that email. You'll receive a calendar invitation shortly. Is there anything else you need?";
      } else {
        // Handle other questions
        return "Is there anything else you'd like to know about the appointment?";
      }
    }
    
    // Fallback
    return null;
  }
  
  async confirmAndBook() {
    try {
      // Try to book the appointment
      let bookingResult = null;
      
      if (isCalendarInitialized() && this.customerInfo.selectedSlot) {
        console.log('📅 Calendar is ready, attempting to book...');
        console.log('📅 Selected slot:', this.customerInfo.selectedSlot);
        
        const bookingDate = new Date(this.customerInfo.selectedSlot.startTime);
        
        bookingResult = await autoBookAppointment(
          this.customerInfo.name || this.customerInfo.firstName,
          this.customerInfo.email || 'pending@halfpriceroof.com', // Placeholder if no email yet
          this.customerInfo.phone || '',
          bookingDate,
          {
            service: this.customerInfo.issue,
            propertyType: this.customerInfo.propertyType,
            urgency: this.customerInfo.urgency,
            roofAge: this.customerInfo.roofAge,
            insurance: this.customerInfo.insuranceClaim,
            source: 'Phone Call',
            company: this.config.companyName,
            specificTime: this.customerInfo.specificTime
          }
        );
        
        if (bookingResult.success) {
          console.log('✅ Appointment booked successfully!');
          if (!this.customerInfo.email) {
            return `Perfect ${this.customerInfo.firstName}! I've got you booked for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our inspector will call 30 minutes before arrival. Would you like me to send a confirmation email?`;
          } else {
            return `Perfect ${this.customerInfo.firstName}! I've got you booked for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. You'll receive a confirmation at ${this.customerInfo.email}. Our inspector will call 30 minutes before arrival. Sound good?`;
          }
        }
      }
      
      // Fallback if booking fails
      console.log('📅 Could not auto-book, will handle manually');
      return `Great ${this.customerInfo.firstName}! I'm putting you down for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our scheduling team will call you shortly to confirm. They'll also call 30 minutes before arrival. Sound good?`;
      
    } catch (error) {
      console.error('❌ Booking error:', error);
      return `Perfect ${this.customerInfo.firstName}! I've noted ${this.customerInfo.day} at ${this.customerInfo.specificTime} for your appointment. Our team will call to confirm. Sound good?`;
    }
  }
  
  getNextDate(dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = new Date();
    
    if (dayName.toLowerCase() === 'today') {
      return today;
    }
    
    if (dayName.toLowerCase() === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow;
    }
    
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
    console.log('📊 Final Summary:');
    console.log('  - Name:', this.customerInfo.firstName || 'Not captured');
    console.log('  - Issue:', this.customerInfo.issue || 'Not captured');
    console.log('  - Property:', this.customerInfo.propertyType || 'Not captured');
    console.log('  - Urgency:', this.customerInfo.urgency || 'Not captured');
    console.log('  - Roof Age:', this.customerInfo.roofAge || 'Not captured');
    console.log('  - Insurance:', this.customerInfo.insuranceClaim || 'Not captured');
    console.log('  - Scheduled:', this.customerInfo.day, this.customerInfo.specificTime || 'Not scheduled');
    console.log('  - Email:', this.customerInfo.email || 'Not captured');
    
    // Send webhook with all discovery data
    if (this.customerInfo.firstName || this.customerInfo.day) {
      await sendSchedulingPreference(
        this.customerInfo.name || this.customerInfo.firstName,
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
          insuranceClaim: this.customerInfo.insuranceClaim,
          company: this.config.companyName,
          callDuration: Date.now(),
          questionsCompleted: Object.values(this.questionsAsked).filter(v => v).length,
          calendarBooked: this.customerInfo.readyToSchedule
        }
      );
    }
  }
}

module.exports = DynamicWebSocketHandler;
