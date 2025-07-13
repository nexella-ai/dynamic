// src/handlers/DynamicWebSocketHandler.js - WITH SILENCE DETECTION & TRANSCRIPT VALIDATION
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
    this.validMessageCount = 0; // Only count valid, meaningful messages
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
      propertyAddress: null,
      // Scheduling
      day: null,
      specificTime: null,
      timePreference: null,
      availableSlots: [],
      selectedSlot: null,
      readyToSchedule: false
    };
    
    // Discovery phases
    this.discoveryPhase = 'waiting'; // waiting -> greeting -> need -> details -> scheduling -> time_selection -> booking
    this.hasGreeted = false;
    this.waitingForResponse = false;
    this.lastBotMessage = null;
    this.lastBotMessageTime = 0;
    
    // Silence and transcript management
    this.silenceCount = 0;
    this.lastValidUserMessage = null;
    this.transcriptHistory = [];
    this.lastUserSpokeTime = 0;
    
    // Response control
    this.responseDelay = 2000; // Wait 2 seconds before responding
    this.pendingResponseTimeout = null;
    this.minimumUserMessageLength = 2; // Ignore single character responses
    
    // Common transcript errors to ignore
    this.transcriptErrorPatterns = [
      /^(uh|um|ah|oh|eh|hm+)$/i,
      /^(guess it's|guess its)/i,
      /^no\.$|^yes\.$/i, // Single word with period often means unclear audio
      /^i'm$/i,
      /^oh,? i'm$/i,
      /from.*here$/i // Partial transcriptions like "from X here"
    ];
    
    // Initialize
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
  
  isValidUserMessage(message) {
    if (!message || typeof message !== 'string') return false;
    
    const trimmed = message.trim();
    
    // Check minimum length
    if (trimmed.length < this.minimumUserMessageLength) return false;
    
    // Check for common transcript errors
    for (const pattern of this.transcriptErrorPatterns) {
      if (pattern.test(trimmed)) {
        console.log(`🚫 Ignoring transcript error: "${trimmed}"`);
        return false;
      }
    }
    
    // Check if it's just gibberish or partial words
    if (trimmed.split(' ').every(word => word.length < 2)) return false;
    
    // Check if it's too similar to our bot's name/company
    if (trimmed.toLowerCase().includes("mike from aflac") || 
        trimmed.toLowerCase().includes("from aflac's creek")) {
      console.log(`🚫 Ignoring misheard bot introduction: "${trimmed}"`);
      return false;
    }
    
    return true;
  }
  
  async handleIncomingMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    
    // Validate the message first
    if (!this.isValidUserMessage(userMessage)) {
      console.log(`🔇 Invalid/unclear message ignored: "${userMessage}"`);
      return;
    }
    
    console.log(`🗣️ User: ${userMessage}`);
    
    // Track user activity
    this.lastUserSpokeTime = Date.now();
    this.lastValidUserMessage = userMessage;
    this.transcriptHistory.push({
      message: userMessage,
      timestamp: Date.now(),
      valid: true
    });
    
    // Cancel any pending response
    if (this.pendingResponseTimeout) {
      clearTimeout(this.pendingResponseTimeout);
    }
    
    // If we haven't greeted yet and user said hello, greet immediately
    if (!this.hasGreeted && userMessage.toLowerCase().includes('hello')) {
      this.discoveryPhase = 'greeting';
      await this.sendResponse("Hey! Mike from Half Price Roof here. How's it going today?", parsed.response_id);
      this.hasGreeted = true;
      this.waitingForResponse = true;
      return;
    }
    
    // For all other messages, wait a bit to see if they'll say more
    this.pendingResponseTimeout = setTimeout(async () => {
      await this.processUserMessage(userMessage, parsed);
    }, this.responseDelay);
  }
  
  async processUserMessage(userMessage, parsed) {
    const lower = userMessage.toLowerCase();
    
    // Increment valid message count
    this.validMessageCount++;
    
    // Check if this is silence after we asked a question
    const timeSinceLastBot = Date.now() - this.lastBotMessageTime;
    if (this.waitingForResponse && timeSinceLastBot > 10000) {
      // User has been silent for 10+ seconds after our question
      this.silenceCount++;
      if (this.silenceCount >= 2) {
        await this.sendResponse("Are you still there? I'm here to help with any roofing needs you might have.", parsed.response_id);
        this.silenceCount = 0;
        return;
      }
    }
    
    // Get appropriate response based on conversation phase
    let response = await this.getResponse(userMessage);
    
    if (response) {
      await this.sendResponse(response, parsed.response_id);
    }
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 Mike: ${content}`);
    
    this.lastBotMessage = content;
    this.lastBotMessageTime = Date.now();
    this.waitingForResponse = true;
    this.silenceCount = 0;
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId
    }));
  }
  
  async getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Handle different conversation phases
    switch (this.discoveryPhase) {
      case 'greeting':
        return this.handleGreetingResponse(userMessage);
        
      case 'need':
        return this.handleNeedResponse(userMessage);
        
      case 'details':
        return this.handleDetailsResponse(userMessage);
        
      case 'urgency':
        return this.handleUrgencyResponse(userMessage);
        
      case 'roofAge':
        return this.handleRoofAgeResponse(userMessage);
        
      case 'insurance':
        return this.handleInsuranceResponse(userMessage);
        
      case 'getName':
        return this.handleNameResponse(userMessage);
        
      case 'scheduling':
        return this.handleSchedulingResponse(userMessage);
        
      case 'time_selection':
        return this.handleTimeSelectionResponse(userMessage);
        
      case 'confirmation':
        return this.handleConfirmationResponse(userMessage);
        
      default:
        // We're in waiting phase, shouldn't respond unless greeted
        return null;
    }
  }
  
  handleGreetingResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    this.discoveryPhase = 'need';
    
    if (lower.includes('good') || lower.includes('great') || lower.includes('fine') || lower.includes('well')) {
      return "That's great to hear! So what's going on with your roof? Are you dealing with any leaks, need a replacement, or just looking for an inspection?";
    } else if (lower.includes('not') && (lower.includes('good') || lower.includes('great'))) {
      return "Sorry to hear that. Well, I'm here to help with any roofing issues. Is your roof giving you trouble?";
    } else if (lower.includes('hello') || lower.includes('hi')) {
      // They just said hello back
      return "Thanks for taking my call! What can I help you with today - are you having any issues with your roof?";
    } else {
      // Generic response
      return "I appreciate you taking my call. What's going on with your roof today?";
    }
  }
  
  handleNeedResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('replac')) {
      this.customerInfo.issue = 'replacement';
      this.discoveryPhase = 'details';
      return "Got it, you need a full roof replacement. Is this for your home or a commercial property?";
    } else if (lower.includes('leak') || lower.includes('water') || lower.includes('drip')) {
      this.customerInfo.issue = 'leak';
      this.discoveryPhase = 'details';
      return "Oh no, a leak! Those definitely need quick attention. Is this happening at your home or a business property?";
    } else if (lower.includes('inspect') || lower.includes('check') || lower.includes('look')) {
      this.customerInfo.issue = 'inspection';
      this.discoveryPhase = 'details';
      return "Smart thinking! Regular inspections can catch problems early. Is this for a residential or commercial property?";
    } else if (lower.includes('repair') || lower.includes('fix')) {
      this.customerInfo.issue = 'repair';
      this.discoveryPhase = 'details';
      return "I can definitely help with repairs. Is this for your home or a commercial building?";
    } else if (lower.includes('damage') || lower.includes('storm') || lower.includes('hail') || lower.includes('wind')) {
      this.customerInfo.issue = 'storm damage';
      this.discoveryPhase = 'details';
      return "Storm damage can be serious. Is this your residential property or a commercial one?";
    } else if (lower.includes('not sure') || lower.includes("don't know")) {
      return "No problem! I can have our inspector take a look and let you know exactly what's needed. Is this for your home?";
    } else {
      // Clarify
      return "I can help with repairs, full replacements, or free inspections. Which one sounds like what you need?";
    }
  }
  
  handleDetailsResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('home') || lower.includes('house') || lower.includes('residential') || 
        lower === 'yes' || lower.includes('my place')) {
      this.customerInfo.propertyType = 'residential';
      this.discoveryPhase = 'urgency';
      
      if (this.customerInfo.issue === 'leak') {
        return "I'll make sure we get someone out there quickly. Is water actively coming in right now?";
      } else {
        return "Perfect. How soon do you need someone to come take a look - is this urgent or are you planning ahead?";
      }
    } else if (lower.includes('commercial') || lower.includes('business') || lower.includes('office') || 
               lower.includes('building') || lower.includes('store')) {
      this.customerInfo.propertyType = 'commercial';
      this.discoveryPhase = 'urgency';
      return "We handle a lot of commercial properties. How urgent is this for your business operations?";
    } else if (lower === 'no') {
      return "Got it. So is this for a commercial property then?";
    } else {
      return "Just to clarify - is this for a home or a business property?";
    }
  }
  
  handleUrgencyResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') && this.customerInfo.issue === 'leak') {
      // Active leak
      this.customerInfo.urgency = 'emergency';
      this.discoveryPhase = 'roofAge';
      return "We'll get our emergency crew out there right away. While I'm scheduling this, can you tell me roughly how old your roof is?";
    } else if (lower.includes('asap') || lower.includes('soon as possible') || lower.includes('immediately') || 
               lower.includes('emergency') || lower.includes('urgent') || lower.includes('right away') ||
               lower.includes('today') || lower.includes('active')) {
      this.customerInfo.urgency = 'emergency';
      this.discoveryPhase = 'roofAge';
      return "I understand this is urgent. We have crews available for emergency calls. Do you know approximately how old your roof is?";
    } else if (lower.includes('this week') || lower.includes('soon') || lower.includes('quick')) {
      this.customerInfo.urgency = 'this week';
      this.discoveryPhase = 'roofAge';
      return "We can definitely get someone out this week. About how old is your current roof?";
    } else if (lower.includes('planning') || lower.includes('quote') || lower.includes('estimate') || 
               lower.includes('not urgent') || lower.includes('no rush') || lower === 'no') {
      this.customerInfo.urgency = 'planning';
      this.discoveryPhase = 'roofAge';
      return "It's great that you're planning ahead! Do you know roughly how old your roof is?";
    } else {
      return "Would you say you need someone out there within the next few days, or is this more for future planning?";
    }
  }
  
  handleRoofAgeResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Extract age
    const ageMatch = lower.match(/(\d+)\s*(year|yr)/);
    const thirtyMatch = lower.match(/thirty|30/);
    const twentyMatch = lower.match(/twenty|20/);
    
    if (ageMatch) {
      this.customerInfo.roofAge = `${ageMatch[1]} years`;
    } else if (thirtyMatch) {
      this.customerInfo.roofAge = '30+ years';
    } else if (twentyMatch) {
      this.customerInfo.roofAge = '20+ years';
    } else if (lower.includes('old') || lower.includes('original')) {
      this.customerInfo.roofAge = 'very old';
    } else if (lower.includes('new') || lower.includes('recent') || lower.includes('few')) {
      this.customerInfo.roofAge = 'less than 5 years';
    } else if (lower.includes("don't know") || lower.includes('not sure') || lower.includes('no idea')) {
      this.customerInfo.roofAge = 'unknown';
    } else {
      this.customerInfo.roofAge = userMessage; // Store whatever they said
    }
    
    // Move to insurance question for damage/leaks, or skip to name for others
    if (this.customerInfo.issue === 'storm damage' || this.customerInfo.issue === 'leak') {
      this.discoveryPhase = 'insurance';
      return "Thanks for that info. Are you planning to file an insurance claim for this damage?";
    } else {
      this.discoveryPhase = 'getName';
      return "Great, thanks for that information! Now let me get you scheduled. What's your first name?";
    }
  }
  
  handleInsuranceResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('definitely') || lower.includes('planning to')) {
      this.customerInfo.insuranceClaim = 'yes';
      this.discoveryPhase = 'getName';
      return "Perfect! We work with all insurance companies and can help document everything for your claim. What's your first name for the appointment?";
    } else if (lower.includes('no') || lower.includes('not')) {
      this.customerInfo.insuranceClaim = 'no';
      this.discoveryPhase = 'getName';
      return "No problem at all. We have great cash pricing and payment options. What's your first name?";
    } else if (lower.includes('maybe') || lower.includes('not sure') || lower.includes('might')) {
      this.customerInfo.insuranceClaim = 'maybe';
      this.discoveryPhase = 'getName';
      return "That's fine! Our inspector can help you determine if it's worth filing a claim. What's your first name?";
    } else {
      return "Will you be using insurance for this, or would you prefer to handle it directly?";
    }
  }
  
  handleNameResponse(userMessage) {
    // Enhanced name extraction
    const nameMatch = userMessage.match(/(?:my name is |i'm |i am |it's |this is |call me )?([A-Z][a-z]+)/);
    
    if (nameMatch) {
      this.customerInfo.firstName = nameMatch[1];
      this.customerInfo.name = nameMatch[1];
      this.discoveryPhase = 'scheduling';
      
      if (this.customerInfo.urgency === 'emergency') {
        return `Thanks ${this.customerInfo.firstName}! Since this is urgent, I can get someone there today or tomorrow. Which day works better for you?`;
      } else {
        return `Perfect, ${this.customerInfo.firstName}! Let me check our schedule. What day works best for you this week?`;
      }
    } else if (userMessage.length < 20 && /^[A-Z][a-z]+$/.test(userMessage.trim())) {
      // Just a single capitalized word - likely a name
      this.customerInfo.firstName = userMessage.trim();
      this.customerInfo.name = userMessage.trim();
      this.discoveryPhase = 'scheduling';
      return `Great, ${this.customerInfo.firstName}! What day works best for you to have someone come out?`;
    } else {
      return "I didn't quite catch that. Could you tell me your first name please?";
    }
  }
  
  async handleSchedulingResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow'];
    const dayFound = days.find(day => lower.includes(day));
    
    if (dayFound) {
      this.customerInfo.day = dayFound.charAt(0).toUpperCase() + dayFound.slice(1);
      
      // Get available slots for that day
      const targetDate = this.getNextDate(this.customerInfo.day);
      const availableSlots = await getAvailableTimeSlots(targetDate);
      
      if (availableSlots.length > 0) {
        this.customerInfo.availableSlots = availableSlots;
        this.discoveryPhase = 'time_selection';
        
        // Group slots by morning/afternoon
        const morningSlots = availableSlots.filter(s => {
          const hour = parseInt(s.displayTime.split(':')[0]);
          return s.displayTime.includes('AM') || (hour === 12 && s.displayTime.includes('PM'));
        });
        const afternoonSlots = availableSlots.filter(s => {
          const hour = parseInt(s.displayTime.split(':')[0]);
          return s.displayTime.includes('PM') && hour !== 12;
        });
        
        // Offer specific times
        if (morningSlots.length > 0 && afternoonSlots.length > 0) {
          return `Great! I have ${morningSlots[0].displayTime} in the morning or ${afternoonSlots[0].displayTime} in the afternoon available on ${this.customerInfo.day}. Which works better for you?`;
        } else if (morningSlots.length > 0) {
          const times = morningSlots.slice(0, 2).map(s => s.displayTime).join(' or ');
          return `For ${this.customerInfo.day}, I have ${times} available. Which time works best?`;
        } else if (afternoonSlots.length > 0) {
          const times = afternoonSlots.slice(0, 2).map(s => s.displayTime).join(' or ');
          return `For ${this.customerInfo.day}, I have ${times} available in the afternoon. Does one of those work?`;
        }
      } else {
        // No slots available
        this.customerInfo.day = null;
        return `I don't have any openings on ${dayFound}. Would the following day work instead?`;
      }
    } else if (lower.includes('week') || lower.includes('whenever') || lower.includes('flexible')) {
      return "I have good availability Thursday and Friday. Which day would you prefer?";
    } else {
      return "What day works best for you? I have openings most days this week.";
    }
  }
  
  async handleTimeSelectionResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Look for specific time mentions
    const timeMatch = userMessage.match(/(\d{1,2})\s*(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
    const morningWords = ['morning', 'first', 'early', 'earlier'];
    const afternoonWords = ['afternoon', 'later', 'second'];
    
    let selectedSlot = null;
    
    if (timeMatch) {
      const requestedHour = parseInt(timeMatch[1]);
      const isPM = timeMatch[3] && timeMatch[3].toLowerCase().includes('p');
      
      // Find exact or close match
      selectedSlot = this.customerInfo.availableSlots.find(slot => {
        const slotTime = slot.displayTime.toLowerCase();
        return slotTime.includes(`${requestedHour}:`) && 
               (isPM ? slotTime.includes('pm') : slotTime.includes('am'));
      });
    } else if (morningWords.some(word => lower.includes(word))) {
      // Select first morning slot
      selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime.includes('AM'));
    } else if (afternoonWords.some(word => lower.includes(word))) {
      // Select first afternoon slot
      selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime.includes('PM'));
    } else if (lower.includes('either') || lower.includes('any') || lower.includes('work')) {
      // They're flexible, use first available
      selectedSlot = this.customerInfo.availableSlots[0];
    }
    
    if (selectedSlot) {
      this.customerInfo.selectedSlot = selectedSlot;
      this.customerInfo.specificTime = selectedSlot.displayTime;
      this.customerInfo.readyToSchedule = true;
      this.discoveryPhase = 'confirmation';
      return await this.confirmAndBook();
    } else {
      // Couldn't match, ask for clarification
      const availableTimes = this.customerInfo.availableSlots.slice(0, 3).map(s => s.displayTime).join(', ');
      return `I have ${availableTimes} available. Which specific time works best for you?`;
    }
  }
  
  handleConfirmationResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('sounds good') || lower.includes('perfect') || 
        lower.includes('great') || lower.includes('ok') || lower.includes('sure')) {
      return `Excellent! You're all set for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our inspector will call you 30 minutes before arriving. Is there anything else you need to know?`;
    } else if (lower.includes('email')) {
      return "Sure! What email address should I send the confirmation to?";
    } else if (lower.includes('@')) {
      // They provided an email
      this.customerInfo.email = userMessage.trim();
      return "Perfect! I've added your email. You'll receive a calendar invitation shortly. Have a great day!";
    } else if (lower.includes('what time') || lower.includes('when')) {
      return `Your appointment is scheduled for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. We'll call 30 minutes before arrival.`;
    } else if (lower.includes('no') || lower.includes('cancel') || lower.includes('different')) {
      this.discoveryPhase = 'scheduling';
      this.customerInfo.day = null;
      this.customerInfo.selectedSlot = null;
      return "No problem! What day would work better for you?";
    } else {
      return "Do you have any questions about the appointment?";
    }
  }
  
  async confirmAndBook() {
    try {
      let bookingResult = null;
      
      if (isCalendarInitialized() && this.customerInfo.selectedSlot) {
        console.log('📅 Attempting calendar booking...');
        
        const bookingDate = new Date(this.customerInfo.selectedSlot.startTime);
        
        bookingResult = await autoBookAppointment(
          this.customerInfo.name || this.customerInfo.firstName,
          this.customerInfo.email || `${this.customerInfo.firstName.toLowerCase()}@customer.halfpriceroof.com`,
          this.customerInfo.phone || '',
          bookingDate,
          {
            service: this.customerInfo.issue,
            propertyType: this.customerInfo.propertyType,
            urgency: this.customerInfo.urgency,
            roofAge: this.customerInfo.roofAge,
            insurance: this.customerInfo.insuranceClaim,
            source: 'Phone Call',
            company: this.config.companyName
          }
        );
        
        if (bookingResult.success) {
          console.log('✅ Calendar booking successful!');
          return `Perfect ${this.customerInfo.firstName}! I've got you booked for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. You'll receive a confirmation shortly. Our inspector will call 30 minutes before arrival. Sound good?`;
        }
      }
      
      // Fallback if booking fails
      console.log('📅 Calendar booking failed or unavailable');
      return `Great ${this.customerInfo.firstName}! I'm scheduling you for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our office will call shortly to confirm. The inspector will also call 30 minutes before arrival. Sound good?`;
      
    } catch (error) {
      console.error('❌ Booking error:', error);
      return `I've noted your appointment for ${this.customerInfo.day} at ${this.customerInfo.specificTime}. Our team will call to confirm shortly. Sound good?`;
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
    console.log(`📊 Call Summary:`);
    console.log(`  - Valid messages received: ${this.validMessageCount}`);
    console.log(`  - Customer: ${this.customerInfo.firstName || 'Not captured'}`);
    console.log(`  - Issue: ${this.customerInfo.issue || 'Not identified'}`);
    console.log(`  - Scheduled: ${this.customerInfo.day} ${this.customerInfo.specificTime || ''}`);
    
    // Send webhook only if we got meaningful information
    if (this.customerInfo.firstName || this.customerInfo.issue || this.validMessageCount > 2) {
      await sendSchedulingPreference(
        this.customerInfo.name || this.customerInfo.firstName || 'Unknown',
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
          validMessageCount: this.validMessageCount,
          calendarBooked: this.customerInfo.readyToSchedule
        }
      );
    }
  }
}

module.exports = DynamicWebSocketHandler;
