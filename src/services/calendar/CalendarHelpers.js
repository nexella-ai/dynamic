// src/services/calendar/CalendarHelpers.js - FIXED (NO DEMO MODE, REAL CALENDAR ONLY)
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
    throw error; // Don't continue without calendar
  }
}

// Check availability - REAL CALENDAR ONLY
async function checkAvailability(startTime, endTime) {
  try {
    console.log('🔍 Checking calendar availability...');
    console.log('⏰ Start time:', startTime);
    console.log('⏰ End time:', endTime);
    
    if (!calendarInitialized || !calendarService?.isInitialized()) {
      throw new Error('Calendar service not available');
    }
    
    const available = await calendarService.isSlotAvailable(startTime, endTime);
    console.log('📊 Real calendar result:', available);
    return available;
  } catch (error) {
    console.error('❌ Error checking calendar availability:', error.message);
    throw error;
  }
}

// Get available time slots - REAL CALENDAR ONLY
async function getAvailableTimeSlots(date) {
  try {
    console.log('📅 Getting available calendar slots for:', date);
    
    if (!calendarService) {
      throw new Error('No calendar service initialized');
    }
    
    if (!calendarInitialized) {
      throw new Error('Calendar service not properly initialized');
    }
    
    console.log('📅 Using REAL Google Calendar');
    const availableSlots = await calendarService.getAvailableSlots(date);
    console.log(`📋 Retrieved ${availableSlots.length} real calendar slots`);
    return availableSlots;
    
  } catch (error) {
    console.error('❌ Error getting calendar slots:', error.message);
    throw error; // Don't return fallback data
  }
}

// Get formatted available slots
async function getFormattedAvailableSlots(startDate = null, daysAhead = 7) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const searchStart = startDate ? new Date(startDate) : today;
    
    console.log(`📅 Getting calendar slots starting from: ${searchStart.toDateString()}`);
    
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
            day: 'numeric'
          });
          
          // Take first 4 slots
          const limitedSlots = slots.slice(0, 4);
          
          allAvailableSlots.push({
            date: checkDate.toDateString(),
            dayName: dayName,
            slots: limitedSlots,
            formattedSlots: limitedSlots.map(slot => slot.displayTime).join(', ')
          });
          
          console.log(`✅ Added ${limitedSlots.length} calendar slots for ${dayName}: ${limitedSlots.map(s => s.displayTime).join(', ')}`);
        } else {
          console.log(`📅 No calendar availability found for ${checkDate.toDateString()}`);
        }
      } catch (dayError) {
        console.error(`❌ Error getting calendar slots for ${checkDate.toDateString()}:`, dayError.message);
        throw dayError; // Don't continue with errors
      }
    }
    
    console.log(`✅ Found calendar slots across ${allAvailableSlots.length} days`);
    return allAvailableSlots;
    
  } catch (error) {
    console.error('❌ Error getting formatted calendar slots:', error.message);
    throw error;
  }
}

// Generate availability response
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

// Auto-booking function for when user provides specific time
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
    
    const bookingResult = await calendarService.createEvent(appointmentDetails);
    
    if (bookingResult.success) {
      console.log('✅ Auto-booking appointment successful!');
      return {
        success: true,
        eventId: bookingResult.eventId,
        meetingLink: bookingResult.meetingLink,
        eventLink: bookingResult.eventLink,
        message: `Perfect! I've booked your consultation for ${startTime.toLocaleDateString('en-US', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        })} at ${startTime.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true 
        })}. You'll receive a calendar invitation shortly.`,
        isDemo: false
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

// Parse user's scheduling preference
async function suggestAlternativeTime(preferredDate, userMessage) {
  try {
    console.log('🔍 Suggesting alternative appointment times for:', preferredDate);
    
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

function handleSchedulingPreference(userMessage) {
  console.log('🔍 Analyzing user message for appointment scheduling:', userMessage);
  
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
      fullPreference: userMessage
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
        fullPreference: userMessage
      };
    } else if (preferredDay === 'today') {
      return {
        dayName: 'today',
        date: targetDate,
        isSpecific: true,
        timePreference: timeMatch ? timeMatch[0] : 'afternoon',
        fullPreference: userMessage
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
          fullPreference: userMessage
        };
      }
    }
  }
  
  return null;
}

// Utility functions
function formatDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    })} from ${start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    })} to ${end.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    })}`;
  } else {
    return `${start.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    })} at ${start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    })}`;
  }
}

function isBusinessHours(dateTime) {
  const date = new Date(dateTime);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = date.getHours();
  
  // Monday to Friday (1-5), 8 AM to 4 PM
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
  suggestAlternativeTime,
  handleSchedulingPreference,
  formatDateRange,
  isBusinessHours,
  getNextBusinessDay,
  getCalendarService,
  isCalendarInitialized
};
