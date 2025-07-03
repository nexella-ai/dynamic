// src/services/booking/BookingManager.js
const { 
  getAvailableTimeSlots, 
  autoBookAppointment 
} = require('../calendar/CalendarHelpers');
const TimezoneHandler = require('../timezone/TimezoneHandler');

class BookingManager {
  constructor(connectionData) {
    this.connectionData = connectionData;
    this.timezoneHandler = new TimezoneHandler();
    
    // Booking state
    this.bookingState = {
      userTimezone: null,
      timezoneConfirmed: false,
      selectedDay: null,
      selectedTime: null,
      offeredSlots: [],
      awaitingDaySelection: false,
      awaitingTimeSelection: false,
      bookingInProgress: false,
      bookingCompleted: false
    };
    
    // Anti-duplicate booking
    this.lastBookingAttempt = 0;
    this.bookingCooldown = 5000; // 5 seconds
  }

  /**
   * Initialize timezone from phone number
   */
  initializeTimezone() {
    if (this.connectionData.customerPhone && !this.bookingState.userTimezone) {
      const detectedTimezone = this.timezoneHandler.detectTimezoneFromPhone(
        this.connectionData.customerPhone
      );
      
      if (detectedTimezone) {
        this.bookingState.userTimezone = detectedTimezone;
        const timezoneName = this.timezoneHandler.getTimezoneName(detectedTimezone);
        
        console.log(`🌍 Detected timezone: ${timezoneName} from phone ${this.connectionData.customerPhone}`);
        
        // Return confirmation message
        return `I see you're in ${timezoneName}. I'll show times in your timezone. Sound good?`;
      }
    }
    
    return null;
  }

  /**
   * Handle timezone confirmation
   */
  handleTimezoneResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('correct') || lower.includes('right')) {
      this.bookingState.timezoneConfirmed = true;
      return "Great! What day works best for you this week?";
    } else if (lower.includes('no') || lower.includes('wrong')) {
      return "What timezone are you in? I can adjust the times for you.";
    }
    
    // Check if they specified a timezone
    const specifiedTimezone = this.timezoneHandler.parseTimezoneFromInput(userMessage);
    if (specifiedTimezone) {
      this.bookingState.userTimezone = specifiedTimezone;
      this.bookingState.timezoneConfirmed = true;
      const timezoneName = this.timezoneHandler.getTimezoneName(specifiedTimezone);
      return `Got it! I'll show times in ${timezoneName}. What day works best?`;
    }
    
    return null;
  }

  /**
   * Process booking request
   */
  async processBookingRequest(userMessage) {
    // Prevent duplicate bookings
    const now = Date.now();
    if (now - this.lastBookingAttempt < this.bookingCooldown) {
      console.log('🚫 Booking cooldown active');
      return null;
    }
    
    // Initialize timezone if needed
    if (!this.bookingState.userTimezone && !this.bookingState.timezoneConfirmed) {
      const timezoneMessage = this.initializeTimezone();
      if (timezoneMessage) {
        return timezoneMessage;
      }
    }
    
    // Handle timezone confirmation
    if (this.bookingState.userTimezone && !this.bookingState.timezoneConfirmed) {
      const confirmResponse = this.handleTimezoneResponse(userMessage);
      if (confirmResponse) {
        return confirmResponse;
      }
    }
    
    // Parse day selection
    const dayMatch = this.parseDayFromMessage(userMessage);
    if (dayMatch && !this.bookingState.selectedDay) {
      return await this.handleDaySelection(dayMatch);
    }
    
    // Parse time selection
    if (this.bookingState.awaitingTimeSelection) {
      const timeMatch = this.parseTimeFromMessage(userMessage);
      if (timeMatch) {
        return await this.handleTimeSelection(timeMatch);
      }
    }
    
    // Parse combined day and time
    const appointmentMatch = this.parseAppointmentFromMessage(userMessage);
    if (appointmentMatch) {
      return await this.handleDirectBooking(appointmentMatch);
    }
    
    return null;
  }

  /**
   * Parse day from user message
   */
  parseDayFromMessage(message) {
    const dayPattern = /\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i;
    const match = message.match(dayPattern);
    return match ? match[0].toLowerCase() : null;
  }

  /**
   * Parse time from user message
   */
  parseTimeFromMessage(message) {
    const patterns = [
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i,
      /\b(morning|afternoon)\b/i,
      /\b(\d{1,2})\s*o'?clock\b/i
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return this.normalizeTimeMatch(match);
      }
    }
    
    return null;
  }

  /**
   * Parse full appointment from message
   */
  parseAppointmentFromMessage(message) {
    const pattern = /\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
    const match = message.match(pattern);
    
    if (match) {
      return {
        day: match[1].toLowerCase(),
        hour: parseInt(match[2]),
        minutes: parseInt(match[3] || '0'),
        period: match[4] || null
      };
    }
    
    return null;
  }

  /**
   * Handle day selection
   */
  async handleDaySelection(day) {
    this.bookingState.selectedDay = day;
    this.bookingState.awaitingDaySelection = false;
    this.bookingState.awaitingTimeSelection = true;
    
    // Calculate target date
    const targetDate = this.calculateTargetDate(day);
    
    try {
      // Get available slots
      const slots = await getAvailableTimeSlots(targetDate);
      
      if (slots.length === 0) {
        this.bookingState.selectedDay = null;
        return `I don't have any openings on ${day}. How about ${this.getNextAvailableDay()}?`;
      }
      
      // Store offered slots
      this.bookingState.offeredSlots = slots.slice(0, 3);
      
      // Convert times to user's timezone if needed
      const userSlots = this.convertSlotsToUserTimezone(this.bookingState.offeredSlots);
      
      // Format response
      if (userSlots.length === 1) {
        return `I have ${userSlots[0].displayTime} available on ${day}. Does that work?`;
      } else if (userSlots.length === 2) {
        return `On ${day}, I have ${userSlots[0].displayTime} or ${userSlots[1].displayTime}. Which works better?`;
      } else {
        return `I have ${userSlots[0].displayTime}, ${userSlots[1].displayTime}, or ${userSlots[2].displayTime} on ${day}. What's best for you?`;
      }
      
    } catch (error) {
      console.error('Error getting slots:', error);
      return "Let me check my calendar... What time of day works best - morning or afternoon?";
    }
  }

  /**
   * Handle time selection
   */
  async handleTimeSelection(timeInfo) {
    if (!this.bookingState.selectedDay || this.bookingState.offeredSlots.length === 0) {
      return "What day did you want to meet?";
    }
    
    // Find matching slot
    const matchedSlot = this.findMatchingSlot(timeInfo);
    
    if (!matchedSlot) {
      return "I don't have that time available. Would any of the times I mentioned work?";
    }
    
    // Book the appointment
    return await this.bookAppointment(matchedSlot);
  }

  /**
   * Handle direct booking (day + time)
   */
  async handleDirectBooking(appointmentInfo) {
    const targetDate = this.calculateTargetDate(appointmentInfo.day);
    targetDate.setHours(appointmentInfo.hour, appointmentInfo.minutes, 0, 0);
    
    // Convert to Arizona time if user has different timezone
    let bookingDate = targetDate;
    if (this.bookingState.userTimezone && this.bookingState.userTimezone !== 'America/Phoenix') {
      bookingDate = this.timezoneHandler.convertToArizonaTime(
        targetDate, 
        this.bookingState.userTimezone
      );
    }
    
    // Check business hours
    const hour = bookingDate.getHours();
    if (hour < 8 || hour >= 16) {
      return `Our appointments are between 8 AM and 4 PM Arizona time. What other time works?`;
    }
    
    // Create appointment object
    const appointment = {
      dateTime: bookingDate,
      dayName: appointmentInfo.day,
      hour: hour
    };
    
    return await this.bookAppointment(appointment);
  }

  /**
   * Book the appointment
   */
  async bookAppointment(appointment) {
    // Prevent duplicate bookings
    if (this.bookingState.bookingInProgress || this.bookingState.bookingCompleted) {
      return "I'm already working on your booking!";
    }
    
    this.bookingState.bookingInProgress = true;
    this.lastBookingAttempt = Date.now();
    
    try {
      // Format confirmation with timezone info
      let confirmMessage = `Perfect! I'm booking your appointment for `;
      
      if (this.bookingState.userTimezone && this.bookingState.userTimezone !== 'America/Phoenix') {
        const formatted = this.timezoneHandler.formatAppointmentTime(
          appointment.dateTime,
          this.bookingState.userTimezone
        );
        confirmMessage += `${formatted.userTime} (${formatted.arizonaTime} Arizona time).`;
      } else {
        const displayTime = appointment.dateTime.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        confirmMessage += `${displayTime}.`;
      }
      
      confirmMessage += ` You'll get a calendar invite at ${this.connectionData.customerEmail}!`;
      
      // Book in calendar
      const bookingResult = await autoBookAppointment(
        this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        appointment.dateTime,
        {
          timezone: this.bookingState.userTimezone || 'America/Phoenix',
          company: this.connectionData.companyName,
          painPoint: this.connectionData.painPoint
        }
      );
      
      if (bookingResult.success) {
        this.bookingState.bookingCompleted = true;
        this.bookingState.bookingInProgress = false;
        return confirmMessage;
      } else {
        this.bookingState.bookingInProgress = false;
        return "That time just became unavailable. Let me show you other options.";
      }
      
    } catch (error) {
      console.error('Booking error:', error);
      this.bookingState.bookingInProgress = false;
      return "I had trouble booking that. Let me try another time - what else works?";
    }
  }

  /**
   * Convert slots to user's timezone
   */
  convertSlotsToUserTimezone(slots) {
    if (!this.bookingState.userTimezone || this.bookingState.userTimezone === 'America/Phoenix') {
      return slots;
    }
    
    return slots.map(slot => {
      const converted = this.timezoneHandler.convertFromArizonaTime(
        new Date(slot.startTime),
        this.bookingState.userTimezone
      );
      
      const displayTime = converted.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: this.bookingState.userTimezone
      });
      
      return {
        ...slot,
        displayTime: displayTime,
        userTimezoneStart: converted.toISOString()
      };
    });
  }

  /**
   * Find matching slot from offered times
   */
  findMatchingSlot(timeInfo) {
    // Implementation depends on timeInfo format
    // This is a simplified version
    for (const slot of this.bookingState.offeredSlots) {
      const slotHour = new Date(slot.startTime).getHours();
      if (timeInfo.hour && slotHour === timeInfo.hour) {
        return slot;
      }
    }
    return null;
  }

  /**
   * Calculate target date from day name
   */
  calculateTargetDate(day) {
    const today = new Date();
    let targetDate = new Date();
    
    if (day === 'today') {
      return targetDate;
    } else if (day === 'tomorrow') {
      targetDate.setDate(today.getDate() + 1);
      return targetDate;
    } else {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = days.indexOf(day);
      const currentDay = today.getDay();
      
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      
      targetDate.setDate(today.getDate() + daysToAdd);
      return targetDate;
    }
  }

  /**
   * Get next available day
   */
  getNextAvailableDay() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
    }
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[tomorrow.getDay()];
  }

  /**
   * Normalize time match
   */
  normalizeTimeMatch(match) {
    // Convert various time formats to standard format
    const fullMatch = match[0];
    
    if (fullMatch.includes('morning')) {
      return { hour: 9, minutes: 0, period: 'am' };
    } else if (fullMatch.includes('afternoon')) {
      return { hour: 2, minutes: 0, period: 'pm' };
    }
    
    return {
      hour: parseInt(match[1]),
      minutes: parseInt(match[2] || '0'),
      period: match[3] || null
    };
  }

  /**
   * Get booking state
   */
  getState() {
    return {
      hasTimezone: !!this.bookingState.userTimezone,
      timezoneConfirmed: this.bookingState.timezoneConfirmed,
      selectedDay: this.bookingState.selectedDay,
      awaitingTimeSelection: this.bookingState.awaitingTimeSelection,
      bookingCompleted: this.bookingState.bookingCompleted
    };
  }
}

module.exports = BookingManager;
