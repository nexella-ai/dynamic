// src/services/calendar/CalendarHelpers.js - FINAL FIX: Multiple Times & Booking Detection
const GoogleCalendarService = require('./GoogleCalendarService');

// Initialize calendar service
let calendarService = null;
let calendarInitialized = false;

async function initializeCalendarService() {
  try {
    console.log('🔧 Initializing Google Calendar service...');
    calendarService = new GoogleCalendarService();
    calendarInitialized = await calendarService.initialize();
    
    if (calendarInitialized) {
      console.log('✅ Google Calendar service ready - REAL calendar mode');
      const calendarInfo = calendarService.getCalendarInfo();
      console.log('📅 Calendar Info:', calendarInfo);
    } else {
      throw new Error('Calendar service failed to initialize');
    }
    
    return calendarInitialized;
  } catch (error) {
    console.error('❌ Calendar initialization failed:', error.message);
    throw error;
  }
}

// Check availability - REAL CALENDAR ONLY
async function checkAvailability(startTime, endTime) {
  try {
    console.log('🔍 Checking calendar availability...');
    console.log('⏰ Start time:', startTime);
    console.log('⏰ End time:', endTime);
    
    if (!calendarInitialized || !calendarService?.isInitialized()) {
      throw new Error('Calendar service not available - cannot check availability');
    }
    
    const available = await calendarService.isSlotAvailable(startTime, endTime);
    console.log('📊 Real calendar result:', available);
    return available;
  } catch (error) {
    console.error('❌ Error checking calendar availability:', error.message);
    throw error;
  }
}

// FIXED: Get available time slots with proper business hours filtering
async function getAvailableTimeSlots(date) {
  try {
    console.log('📅 Getting available calendar slots for:', date, '(Arizona MST)');
    
    if (!calendarService) {
      throw new Error('No calendar service initialized');
    }
    
    if (!calendarInitialized) {
      throw new Error('Calendar service not properly initialized');
    }
    
    console.log('📅 Using REAL Google Calendar');
    const availableSlots = await calendarService.getAvailableSlots(date);
    console.log(`📋 Retrieved ${availableSlots.length} real calendar slots from service`);
    
    // FIXED: Don't filter by hour here - the service already handles business hours correctly
    // The issue was double-filtering causing only 1 slot to show
    console.log(`✅ ${availableSlots.length} slots available (business hours already filtered by service)`);
    return availableSlots;
    
  } catch (error) {
    console.error('❌ Error getting calendar slots:', error.message);
    throw error;
  }
}

// Get formatted available slots with proper Arizona MST display
async function getFormattedAvailableSlots(startDate = null, daysAhead = 7) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const searchStart = startDate ? new Date(startDate) : today;
    
    console.log(`📅 Getting calendar slots starting from: ${searchStart.toDateString()} (Arizona MST)`);
    
    const allAvailableSlots = [];
    
    for (let i = 0; i < daysAhead; i++) {
      const checkDate = new Date(searchStart);
      checkDate.setDate(searchStart.getDate() + i);
      
      // Skip past dates
      if (checkDate < today) {
        continue;
      }
      
      // Skip weekends
      const dayOfWeek = checkDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }
      
      try {
        console.log(`🔍 Checking calendar availability for date: ${checkDate.toDateString()}`);
        const slots = await getAvailableTimeSlots(checkDate);
        
        if (slots.length > 0) {
          const dayName = checkDate.toLocaleDateString('en-US', { 
            weekday: 'long',
            month: 'long', 
            day: 'numeric',
            timeZone: 'America/Phoenix'
          });
          
          // FIXED: Take first 4 slots and ensure proper formatting
          const limitedSlots = slots.slice(0, 4).map(slot => ({
            ...slot,
            displayTime: slot.displayTime // Use the displayTime from the service
          }));
          
          allAvailableSlots.push({
            date: checkDate.toDateString(),
            dayName: dayName,
            slots: limitedSlots,
            formattedSlots: limitedSlots.map(slot => slot.displayTime).join(', ')
          });
          
          console.log(`✅ Added ${limitedSlots.length} calendar slots for ${dayName}: ${limitedSlots.map(s => s.displayTime).join(', ')} Arizona MST`);
        } else {
          console.log(`📅 No calendar availability found for ${checkDate.toDateString()}`);
        }
      } catch (dayError) {
        console.error(`❌ Error getting calendar slots for ${checkDate.toDateString()}:`, dayError.message);
        throw dayError;
      }
    }
    
    console.log(`✅ Found calendar slots across ${allAvailableSlots.length} days`);
    return allAvailableSlots;
    
  } catch (error) {
    console.error('❌ Error getting formatted calendar slots:', error.message);
    throw error;
  }
}

// Generate availability response with proper Arizona MST times
async function generateAvailabilityResponse() {
  try {
    console.log('🤖 Generating availability response from calendar...');
    
    const availableSlots = await getFormattedAvailableSlots();
    console.log(`📊 Got ${availableSlots.length} days with calendar availability`);
    
    if (availableSlots.length === 0) {
      return "I don't have any availability in the next week. Let me check for times the following week.";
    }
    
    if (availableSlots.length === 1) {
      const day = availableSlots[0];
      return `I have availability on ${day.dayName} at ${day.formattedSlots}. Which time works best for you?`;
    }
    
    if (availableSlots.length === 2) {
      const day1 = availableSlots[0];
      const day2 = availableSlots[1];
      return `I have a few options available. On ${day1.dayName}, I have ${day1.formattedSlots}. Or on ${day2.dayName}, I have ${day2.formattedSlots}. What works better for you?`;
    }
    
    // 3 or more days available
    let response = "I have several times available this week. ";
    const daysToShow = availableSlots.slice(0, 3);
    
    daysToShow.forEach((day, index) => {
      if (index === 0) {
        response += `${day.dayName} at ${day.formattedSlots}`;
      } else if (index === daysToShow.length - 1) {
        response += `, or ${day.dayName} at ${day.formattedSlots}`;
      } else {
        response += `, ${day.dayName} at ${day.formattedSlots}`;
      }
    });
    response += ". Which day and time would work best for you?";
    
    console.log(`✅ Generated calendar availability response: ${response}`);
    return response;
    
  } catch (error) {
    console.error('❌ Error generating calendar availability response:', error.message);
    throw error;
  }
}

// FIXED: Enhanced appointment booking detection and execution
async function detectAndBookAppointment(userMessage, customerData, discoveryData) {
  try {
    console.log('🕐 DETECTING APPOINTMENT BOOKING REQUEST:', userMessage);
    
    // Enhanced patterns to detect appointment requests
    const patterns = [
      // "Wednesday at 8 AM" or "June 11th at 8 AM"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|june\s+\d{1,2}(?:th|st|nd|rd)?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "8 AM Wednesday" or "8 AM on June 11th"
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|june\s+\d{1,2}(?:th|st|nd|rd)?)/i,
      // "Wednesday 8" or "June 11th 8"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|june\s+\d{1,2}(?:th|st|nd|rd)?)\s+(\d{1,2})\b/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = userMessage.match(pattern);
      if (match) {
        console.log('🎯 APPOINTMENT PATTERN MATCHED:', match);
        
        const appointmentDetails = parseAppointmentMatch(match, i);
        if (appointmentDetails) {
          console.log('📅 PARSED APPOINTMENT DETAILS:', appointmentDetails);
          
          // Validate business hours
          if (appointmentDetails.hour < 8 || appointmentDetails.hour >= 16) {
            return {
              success: false,
              message: `I'd love to schedule you for ${appointmentDetails.timeString}, but our business hours are 8 AM to 4 PM Arizona time. Would you like to choose a time between 8 AM and 4 PM instead?`
            };
          }
          
          // Attempt the booking
          const bookingResult = await autoBookAppointment(
            customerData.customerName || 'Customer',
            customerData.customerEmail,
            customerData.customerPhone,
            appointmentDetails.dateTime,
            discoveryData
          );
          
          if (bookingResult.success) {
            return {
              success: true,
              message: `Perfect! I've booked your consultation for ${appointmentDetails.dayName} at ${appointmentDetails.timeString} Arizona time. You'll receive a calendar invitation shortly!`,
              bookingDetails: bookingResult
            };
          } else {
            return {
              success: false,
              message: `I'm sorry, but ${appointmentDetails.dayName} at ${appointmentDetails.timeString} is no longer available. Let me suggest some other times.`
            };
          }
        }
      }
    }
    
    return null; // No appointment request detected
    
  } catch (error) {
    console.error('❌ Error in appointment booking detection:', error.message);
    return {
      success: false,
      message: "I'd be happy to schedule that appointment for you. Let me check my calendar and get back to you with confirmation."
    };
  }
}

// FIXED: Parse appointment match into structured data
function parseAppointmentMatch(match, patternIndex) {
  let day, hour, minutes = 0, period = 'am';
  
  try {
    switch (patternIndex) {
      case 0: // "Wednesday at 8am" or "June 11th at 8am"
        day = match[1];
        hour = parseInt(match[2]);
        minutes = parseInt(match[3] || '0');
        period = match[4] || 'am';
        break;
      case 1: // "8am Wednesday" or "8am on June 11th"
        hour = parseInt(match[1]);
        minutes = parseInt(match[2] || '0');
        period = match[3] || 'am';
        day = match[4];
        break;
      case 2: // "Wednesday 8" or "June 11th 8"
        day = match[1];
        hour = parseInt(match[2]);
        // Assume AM for morning hours, PM for afternoon
        period = hour >= 8 && hour <= 11 ? 'am' : (hour >= 1 && hour <= 4 ? 'pm' : 'am');
        break;
    }

    // Convert to 24-hour format
    if (period.toLowerCase().includes('p') && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase().includes('a') && hour === 12) {
      hour = 0;
    }

    // Calculate target date
    const targetDate = calculateTargetDate(day, hour, minutes);
    
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const displayPeriod = hour >= 12 ? 'PM' : 'AM';
    
    return {
      dateTime: targetDate,
      dayName: day,
      timeString: `${displayHour}:${minutes.toString().padStart(2, '0')} ${displayPeriod}`,
      hour: hour,
      originalMatch: match[0]
    };
  } catch (error) {
    console.error('❌ Error parsing appointment match:', error.message);
    return null;
  }
}

// FIXED: Calculate target date for appointment
function calculateTargetDate(day, hour, minutes) {
  let targetDate = new Date();
  
  // Handle "June 11th" style dates
  if (day.toLowerCase().includes('june')) {
    const dayMatch = day.match(/(\d{1,2})/);
    if (dayMatch) {
      const dayOfMonth = parseInt(dayMatch[1]);
      targetDate.setMonth(5); // June is month 5 (0-indexed)
      targetDate.setDate(dayOfMonth);
      
      // If the date is in the past this year, move to next year
      const now = new Date();
      if (targetDate < now) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }
    }
  } else if (day === 'tomorrow') {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (day === 'today') {
    // Keep today
  } else {
    // Handle day names
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIndex = daysOfWeek.indexOf(day.toLowerCase());
    if (dayIndex !== -1) {
      const currentDay = targetDate.getDay();
      let daysToAdd = dayIndex - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Next week
      targetDate.setDate(targetDate.getDate() + daysToAdd);
    }
  }
  
  // Set the time (this will be converted to UTC properly by the calendar service)
  targetDate.setHours(hour, minutes, 0, 0);
  return targetDate;
}

// Auto-booking function with proper Arizona MST handling
async function autoBookAppointment(customerName, customerEmail, customerPhone, preferredDateTime, discoveryData = {}) {
  try {
    console.log('🔄 Attempting auto-booking appointment...');
    console.log('👤 Customer:', customerName, customerEmail);
    console.log('📅 Preferred time:', preferredDateTime);
    
    if (!calendarInitialized || !calendarService?.isInitialized()) {
      throw new Error('Calendar service not available for booking');
    }
    
    const startTime = new Date(preferredDateTime);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour
    
    // Validate customer email
    if (!customerEmail || customerEmail === 'prospect@example.com') {
      console.log('❌ No valid customer email for booking');
      return {
        success: false,
        error: 'No customer email',
        message: 'Customer email required for booking'
      };
    }
    
    // Check if slot is available
    const isAvailable = await checkAvailability(startTime.toISOString(), endTime.toISOString());
    
    if (!isAvailable) {
      console.log('❌ Requested appointment slot not available');
      return {
        success: false,
        error: 'Slot not available',
        message: 'That time slot is no longer available. Let me suggest alternatives.'
      };
    }
    
    // Create the appointment
    const appointmentDetails = {
      summary: 'Nexella AI Consultation Call',
      description: `Discovery call with ${customerName}\n\nDiscovery Information:\n${Object.entries(discoveryData).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      attendeeEmail: customerEmail,
      attendeeName: customerName
    };
    
    console.log('📅 Creating appointment with details:', appointmentDetails);
    
    const bookingResult = await calendarService.createEvent(appointmentDetails);
    
    if (bookingResult.success) {
      console.log('✅ Auto-booking appointment successful!');
      
      const displayTime = startTime.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Phoenix'
      });
      
      return {
        success: true,
        eventId: bookingResult.eventId,
        meetingLink: bookingResult.meetingLink,
        eventLink: bookingResult.eventLink,
        message: `Perfect! I've booked your consultation for ${displayTime} Arizona time. You'll receive a calendar invitation shortly.`,
        isDemo: false,
        timezone: 'America/Phoenix',
        displayTime: displayTime
      };
    } else {
      console.log('❌ Auto-booking appointment failed:', bookingResult.error);
      return {
        success: false,
        error: bookingResult.error,
        message: 'Sorry, I had trouble booking that time. Let me suggest some alternatives.'
      };
    }
    
  } catch (error) {
    console.error('❌ Auto-booking appointment error:', error.message);
    throw error;
  }
}

// Parse user's scheduling preference with Arizona MST awareness
async function suggestAlternativeTime(preferredDate, userMessage) {
  try {
    console.log('🔍 Suggesting alternative appointment times for:', preferredDate, '(Arizona MST)');
    
    const availableSlots = await getAvailableTimeSlots(preferredDate);
    
    if (availableSlots.length === 0) {
      return "I don't have any availability that day. Let me check other days this week.";
    }
    
    if (availableSlots.length === 1) {
      return `I have ${availableSlots[0].displayTime} available that day. Does that work for you?`;
    } else if (availableSlots.length >= 2) {
      return `I have a few times available that day: ${availableSlots[0].displayTime} or ${availableSlots[1].displayTime}. Which would you prefer?`;
    }
    
    return "Let me check what times I have available.";
  } catch (error) {
    console.error('Error suggesting alternative appointment time:', error.message);
    throw error;
  }
}

// Handle scheduling preference with proper Arizona MST parsing
function handleSchedulingPreference(userMessage) {
  console.log('🔍 Analyzing user message for appointment scheduling (Arizona MST):', userMessage);
  
  const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/i);
  const timeMatch = userMessage.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i) || 
                   userMessage.match(/\b(morning|afternoon|evening|noon)\b/i);
  const nextWeekMatch = userMessage.match(/next week/i);
  
  console.log('📅 Detected patterns:', { dayMatch, timeMatch, nextWeekMatch });
  
  if (nextWeekMatch) {
    let targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 7);
    const dayOfWeek = targetDate.getDay();
    const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
    targetDate.setDate(targetDate.getDate() + daysUntilMonday - 7);
    
    return {
      dayName: 'next week',
      date: targetDate,
      isSpecific: false,
      timePreference: timeMatch ? timeMatch[0] : 'morning',
      fullPreference: userMessage,
      timezone: 'America/Phoenix'
    };
  } else if (dayMatch) {
    const preferredDay = dayMatch[0].toLowerCase();
    let targetDate = new Date();
    
    if (preferredDay === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
      return {
        dayName: 'tomorrow',
        date: targetDate,
        isSpecific: true,
        timePreference: timeMatch ? timeMatch[0] : 'morning',
        fullPreference: userMessage,
        timezone: 'America/Phoenix'
      };
    } else if (preferredDay === 'today') {
      return {
        dayName: 'today',
        date: targetDate,
        isSpecific: true,
        timePreference: timeMatch ? timeMatch[0] : 'afternoon',
        fullPreference: userMessage,
        timezone: 'America/Phoenix'
      };
    } else {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const requestedDayIndex = daysOfWeek.findIndex(d => d === preferredDay);
      
      if (requestedDayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = requestedDayIndex - currentDay;
        
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        
        return {
          dayName: preferredDay,
          date: targetDate,
          isSpecific: true,
          timePreference: timeMatch ? timeMatch[0] : 'morning',
          fullPreference: userMessage,
          timezone: 'America/Phoenix'
        };
      }
    }
  }
  
  return null;
}

// Utility functions with Arizona MST awareness
function formatDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric',
      timeZone: 'America/Phoenix'
    })} from ${start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true,
      timeZone: 'America/Phoenix'
    })} to ${end.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true,
      timeZone: 'America/Phoenix'
    })} Arizona time`;
  } else {
    return `${start.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric',
      timeZone: 'America/Phoenix'
    })} at ${start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true,
      timeZone: 'America/Phoenix'
    })} Arizona time`;
  }
}

// Business hours check for Arizona MST
function isBusinessHours(dateTime) {
  const date = new Date(dateTime);
  
  // Convert to Arizona time for checking
  const arizonaTime = new Date(date.toLocaleString("en-US", {timeZone: "America/Phoenix"}));
  const dayOfWeek = arizonaTime.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = arizonaTime.getHours();
  
  // Monday to Friday (1-5), 8 AM to 4 PM Arizona time
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour < 16;
}

function getNextBusinessDay(fromDate = new Date()) {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + 1);
  
  while (date.getDay() === 0 || date.getDay() === 6) { // Skip weekends
    date.setDate(date.getDate() + 1);
  }
  
  return date;
}

// Getters
function getCalendarService() {
  return calendarService;
}

function isCalendarInitialized() {
  return calendarInitialized;
}

module.exports = {
  initializeCalendarService,
  checkAvailability,
  getAvailableTimeSlots,
  getFormattedAvailableSlots,
  generateAvailabilityResponse,
  autoBookAppointment,
  detectAndBookAppointment,
  suggestAlternativeTime,
  handleSchedulingPreference,
  formatDateRange,
  isBusinessHours,
  getNextBusinessDay,
  getCalendarService,
  isCalendarInitialized
};
