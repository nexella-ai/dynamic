// src/services/booking/BookingManager.js - FIXED VERSION WITH ANTI-LOOP PROTECTION
const { 
  getAvailableTimeSlots, 
  autoBookAppointment 
} = require('../calendar/CalendarHelpers');

class BookingManager {
  constructor(connectionData) {
    this.connectionData = connectionData;
    
    // Simplified booking state
    this.bookingState = {
      selectedDay: null,
      selectedTime: null,
      offeredSlots: [],
      awaitingDaySelection: false,
      awaitingTimeSelection: false,
      bookingInProgress: false,
      bookingCompleted: false,
      lastAttemptTime: 0,
      // CRITICAL: Track processing to prevent loops
      isProcessingResponse: false,
      lastProcessedMessage: null,
      lastResponseSent: null
    };
    
    // Anti-duplicate booking
    this.bookingCooldown = 5000; // 5 seconds
    this.responseCooldown = 2000; // 2 seconds between responses
  }

  /**
   * Process booking request - FIXED WITH ANTI-LOOP
   */
  async processBookingRequest(userMessage) {
    // CRITICAL: Prevent duplicate processing
    if (this.bookingState.isProcessingResponse) {
      console.log('🚫 Already processing a response, skipping');
      return null;
    }
    
    // CRITICAL: Don't process same message twice
    if (this.bookingState.lastProcessedMessage === userMessage) {
      console.log('🚫 Already processed this message:', userMessage);
      return null;
    }
    
    // Prevent duplicate bookings
    const now = Date.now();
    if (this.bookingState.bookingCompleted) {
      console.log('✅ Booking already completed');
      return "Your appointment is already booked! You'll receive a calendar invitation shortly.";
    }
    
    if (now - this.bookingState.lastAttemptTime < this.bookingCooldown) {
      console.log('🚫 Booking cooldown active');
      return null;
    }
    
    // Mark as processing
    this.bookingState.isProcessingResponse = true;
    this.bookingState.lastProcessedMessage = userMessage;
    
    try {
      // Parse appointment from message (day + time together)
      const appointmentMatch = this.parseAppointmentFromMessage(userMessage);
      if (appointmentMatch) {
        return await this.handleDirectBooking(appointmentMatch);
      }
      
      // Parse day selection
      const dayMatch = this.parseDayFromMessage(userMessage);
      if (dayMatch && !this.bookingState.selectedDay) {
        return await this.handleDaySelection(dayMatch);
      }
      
      // Parse time selection (if we're waiting for it)
      if (this.bookingState.awaitingTimeSelection && this.bookingState.selectedDay) {
        const timeMatch = this.parseTimeFromMessage(userMessage);
        if (timeMatch) {
          return await this.handleTimeSelection(timeMatch);
        }
      }
      
      // Default prompts - but check cooldown
      if (now - this.bookingState.lastAttemptTime < this.responseCooldown) {
        return null;
      }
      
      if (!this.bookingState.selectedDay) {
        return "What day works best for you this week?";
      } else if (this.bookingState.awaitingTimeSelection) {
        // Don't keep asking for time if we just asked
        if (this.bookingState.lastResponseSent?.includes('Which time works best')) {
          return null;
        }
        return "What time works best for you?";
      }
      
      return null;
    } finally {
      // Always clear processing flag
      setTimeout(() => {
        this.bookingState.isProcessingResponse = false;
      }, 500);
    }
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
   * Parse time from user message - FIXED
   */
  parseTimeFromMessage(message) {
    console.log('🕐 Parsing time from:', message);
    
    const patterns = [
      // "10 AM" or "10:30 AM"
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i,
      // "ten AM"
      /\b(ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)\s*(am|pm)?\b/i,
      // Just "10" or "ten"
      /^(\d{1,2}|ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)$/i
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        console.log('✅ Time pattern matched:', match[0]);
        return this.normalizeTimeMatch(match);
      }
    }
    
    console.log('❌ No time pattern matched');
    return null;
  }

  /**
   * Parse full appointment from message
   */
  parseAppointmentFromMessage(message) {
    const patterns = [
      // "Tuesday at 10 AM"
      /\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\s+(?:at\s+)?(\d{1,2}|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm)?\b/i,
      // "10 AM Tuesday"
      /\b(\d{1,2}|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return this.parseFullAppointmentMatch(match);
      }
    }
    
    return null;
  }

  /**
   * Parse full appointment match
   */
  parseFullAppointmentMatch(match) {
    let day, hour, minutes = 0, period = null;
    
    const wordToNum = {
      'ten': 10, 'eleven': 11, 'twelve': 12,
      'one': 1, 'two': 2, 'three': 3, 'four': 4,
      'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9
    };
    
    // Determine format based on match
    if (match[0].match(/^(monday|tuesday|wednesday|thursday|friday|tomorrow|today)/i)) {
      // Day first format
      day = match[1];
      hour = wordToNum[match[2]?.toLowerCase()] || parseInt(match[2]);
      minutes = parseInt(match[3] || '0');
      period = match[4];
    } else {
      // Time first format
      hour = wordToNum[match[1]?.toLowerCase()] || parseInt(match[1]);
      minutes = parseInt(match[2] || '0');
      period = match[3];
      day = match[4];
    }
    
    // Default AM/PM logic for business hours
    if (!period) {
      if (hour >= 8 && hour <= 11) {
        period = 'am';
      } else if (hour >= 1 && hour <= 4) {
        period = 'pm';
      }
    }
    
    return {
      day: day?.toLowerCase(),
      hour: hour,
      minutes: minutes,
      period: period
    };
  }

  /**
   * Handle day selection
   */
  async handleDaySelection(day) {
    // CRITICAL: Prevent duplicate responses
    if (this.bookingState.selectedDay === day) {
      console.log('🚫 Day already selected:', day);
      return null;
    }
    
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
        this.bookingState.awaitingTimeSelection = false;
        return `I don't have any openings on ${day}. How about ${this.getNextAvailableDay()}?`;
      }
      
      // Store slots
      this.bookingState.offeredSlots = slots.slice(0, 3);
      
      // Format response
      const times = this.bookingState.offeredSlots.map(s => s.displayTime);
      
      let response;
      if (times.length === 1) {
        response = `I have ${times[0]} available on ${day}. Does that work?`;
      } else if (times.length === 2) {
        response = `Perfect! I have ${times[0]} or ${times[1]} available on ${day}. Which works best?`;
      } else {
        response = `Perfect! I have ${times[0]}, ${times[1]}, or ${times[2]} available on ${day}. Which time works best?`;
      }
      
      this.bookingState.lastResponseSent = response;
      this.bookingState.lastAttemptTime = Date.now();
      return response;
      
    } catch (error) {
      console.error('Error getting slots:', error);
      return "Let me check my calendar... What time of day works best - morning or afternoon?";
    }
  }

  /**
   * Handle time selection - FIXED
   */
  async handleTimeSelection(timeInfo) {
    if (!this.bookingState.selectedDay || this.bookingState.offeredSlots.length === 0) {
      return "What day did you want to meet?";
    }
    
    // CRITICAL: Prevent booking if already in progress
    if (this.bookingState.bookingInProgress) {
      console.log('🚫 Booking already in progress');
      return null;
    }
    
    // Find matching slot
    const matchedSlot = this.findMatchingSlot(timeInfo);
    
    if (!matchedSlot) {
      // Try to be more flexible with matching
      const requestedHour = timeInfo.hour;
      const nearbySlot = this.bookingState.offeredSlots.find(slot => {
        const slotHour = new Date(slot.startTime).getHours();
        return Math.abs(slotHour - requestedHour) <= 1; // Within 1 hour
      });
      
      if (nearbySlot) {
        return `I don't have ${this.formatTimeString(timeInfo)}, but I do have ${nearbySlot.displayTime}. Would that work?`;
      }
      
      return "I don't have that time available. Would any of the times I mentioned work for you?";
    }
    
    // Create appointment object
    const appointment = {
      dateTime: new Date(matchedSlot.startTime),
      dayName: this.bookingState.selectedDay,
      timeString: matchedSlot.displayTime,
      hour: new Date(matchedSlot.startTime).getHours()
    };
    
    // Book the appointment
    return await this.bookAppointment(appointment);
  }

  /**
   * Handle direct booking (day + time)
   */
  async handleDirectBooking(appointmentInfo) {
    // Calculate the date
    const targetDate = this.calculateTargetDate(appointmentInfo.day);
    
    // Convert hour to 24-hour format
    let hour24 = appointmentInfo.hour;
    if (appointmentInfo.period?.includes('p') && hour24 !== 12) {
      hour24 += 12;
    } else if (appointmentInfo.period?.includes('a') && hour24 === 12) {
      hour24 = 0;
    }
    
    // Set the time
    targetDate.setHours(hour24, appointmentInfo.minutes, 0, 0);
    
    // Check if it's within business hours
    if (hour24 < 8 || hour24 >= 16) {
      return `Our demo calls are available between 8 AM and 4 PM Arizona time. Would you prefer morning or afternoon?`;
    }
    
    // Create appointment object
    const appointment = {
      dateTime: targetDate,
      dayName: appointmentInfo.day,
      timeString: this.formatTimeFromDate(targetDate),
      hour: hour24
    };
    
    return await this.bookAppointment(appointment);
  }

  /**
   * Book the appointment - SIMPLIFIED WITH LOCK
   */
  async bookAppointment(appointment) {
    // CRITICAL: Prevent duplicate bookings
    if (this.bookingState.bookingInProgress) {
      console.log('🚫 Booking already in progress');
      return null;
    }
    
    if (this.bookingState.bookingCompleted) {
      console.log('🚫 Booking already completed');
      return "I've already booked your appointment!";
    }
    
    // Set multiple locks
    this.bookingState.bookingInProgress = true;
    this.bookingState.lastAttemptTime = Date.now();
    
    try {
      // Format confirmation message
      const confirmMessage = `Perfect! I'm booking your appointment for ${appointment.dayName} at ${appointment.timeString} Arizona time. You'll get a calendar invite at ${this.connectionData.customerEmail}!`;
      
      // CRITICAL: Set booking as completed IMMEDIATELY
      this.bookingState.bookingCompleted = true;
      
      // Book in calendar asynchronously (don't wait for it)
      setTimeout(async () => {
        try {
          const bookingResult = await autoBookAppointment(
            this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
            this.connectionData.customerEmail,
            this.connectionData.customerPhone,
            appointment.dateTime,
            {
              company: this.connectionData.companyName,
              painPoint: this.connectionData.painPoint,
              source: 'AI Voice Assistant'
            }
          );
          
          if (bookingResult.success) {
            console.log('✅ Calendar booking successful!');
          } else {
            console.log('❌ Calendar booking failed:', bookingResult.error);
          }
        } catch (error) {
          console.error('❌ Booking error:', error);
        } finally {
          this.bookingState.bookingInProgress = false;
        }
      }, 100);
      
      return confirmMessage;
      
    } catch (error) {
      console.error('Booking error:', error);
      this.bookingState.bookingInProgress = false;
      this.bookingState.bookingCompleted = false;
      return "I had trouble booking that. Let me try another time - what else works?";
    }
  }

  /**
   * Find matching slot from offered times
   */
  findMatchingSlot(timeInfo) {
    if (!this.bookingState.offeredSlots || this.bookingState.offeredSlots.length === 0) {
      return null;
    }
    
    // Normalize the requested time
    let requestedHour = timeInfo.hour;
    if (timeInfo.period?.includes('p') && requestedHour !== 12) {
      requestedHour += 12;
    } else if (timeInfo.period?.includes('a') && requestedHour === 12) {
      requestedHour = 0;
    }
    
    console.log('🔍 Looking for slot at hour:', requestedHour);
    
    // Check each offered slot
    for (const slot of this.bookingState.offeredSlots) {
      const slotDate = new Date(slot.startTime);
      const slotHour = slotDate.getHours();
      
      console.log(`Comparing slot hour ${slotHour} with requested ${requestedHour}`);
      
      if (slotHour === requestedHour) {
        console.log('✅ Found matching slot!');
        return slot;
      }
    }
    
    console.log('❌ No matching slot found');
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
    const fullMatch = match[0].toLowerCase();
    
    // Word to number conversion
    const wordToNum = {
      'ten': 10, 'eleven': 11, 'twelve': 12,
      'one': 1, 'two': 2, 'three': 3, 'four': 4,
      'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9
    };
    
    let hour, minutes = 0, period = null;
    
    // Check if it's a word number
    const wordMatch = Object.keys(wordToNum).find(word => fullMatch.includes(word));
    if (wordMatch) {
      hour = wordToNum[wordMatch];
      // Extract period if present
      const periodMatch = fullMatch.match(/(am|pm)/i);
      period = periodMatch ? periodMatch[1] : (hour >= 8 && hour <= 11 ? 'am' : 'pm');
    } else {
      hour = parseInt(match[1]);
      minutes = parseInt(match[2] || '0');
      period = match[3] || null;
    }
    
    console.log('📊 Normalized time:', { hour, minutes, period });
    
    return {
      hour: hour,
      minutes: minutes,
      period: period
    };
  }

  /**
   * Format time string from time info
   */
  formatTimeString(timeInfo) {
    const displayHour = timeInfo.hour > 12 ? timeInfo.hour - 12 : timeInfo.hour === 0 ? 12 : timeInfo.hour;
    const displayPeriod = timeInfo.hour >= 12 ? 'PM' : 'AM';
    return `${displayHour}:${timeInfo.minutes.toString().padStart(2, '0')} ${displayPeriod}`;
  }

  /**
   * Format time from date
   */
  formatTimeFromDate(date) {
    const hour = date.getHours();
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const displayPeriod = hour >= 12 ? 'PM' : 'AM';
    return `${displayHour}:00 ${displayPeriod}`;
  }

  /**
   * Get booking state
   */
  getState() {
    return {
      selectedDay: this.bookingState.selectedDay,
      awaitingTimeSelection: this.bookingState.awaitingTimeSelection,
      bookingCompleted: this.bookingState.bookingCompleted,
      bookingInProgress: this.bookingState.bookingInProgress,
      isProcessingResponse: this.bookingState.isProcessingResponse
    };
  }

  /**
   * Reset processing flag (safety method)
   */
  resetProcessing() {
    this.bookingState.isProcessingResponse = false;
    this.bookingState.lastProcessedMessage = null;
  }
}

module.exports = BookingManager;
