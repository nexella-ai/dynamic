// debug-calendar-booking.js - Place in your project root and run with: node debug-calendar-booking.js

require('dotenv').config();

async function debugCalendarBooking() {
  console.log('🔍 DEBUGGING CALENDAR BOOKING IN WEBSOCKET CONTEXT');
  console.log('=====================================');
  
  try {
    // 1. Check if calendar is initialized
    const { isCalendarInitialized, autoBookAppointment } = require('./src/services/calendar/CalendarHelpers');
    
    console.log('\n1. CALENDAR STATUS:');
    console.log('Calendar initialized:', isCalendarInitialized() ? '✅ YES' : '❌ NO');
    
    if (!isCalendarInitialized()) {
      console.log('\n❌ Calendar not initialized - booking will fail');
      console.log('💡 Make sure all Google Calendar environment variables are set');
      return;
    }
    
    // 2. Test the appointment detection patterns
    console.log('\n2. TESTING APPOINTMENT DETECTION PATTERNS:');
    
    const testPhrases = [
      "Thursday at 10 AM",
      "Thursday at ten AM",
      "Can we do Thursday at 10 AM?",
      "Thursday, ten AM",
      "Thursday 10",
      "10 AM Thursday",
      "ten AM on Thursday",
      "Let's do Thursday at 10:00 AM"
    ];
    
    // Create a minimal handler instance just for testing
    const handler = {
      calendarBookingState: { hasDetectedBookingRequest: false },
      detectSpecificAppointmentRequest: function(userMessage) {
        console.log('Testing:', userMessage);
        
        const patterns = [
          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i,
          /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i,
          /(?:can we do|let's do|book|schedule)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i,
          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i
        ];
        
        for (let i = 0; i < patterns.length; i++) {
          const match = userMessage.match(patterns[i]);
          if (match) {
            return { matched: true, pattern: i, match: match[0] };
          }
        }
        return null;
      }
    };
    
    testPhrases.forEach(phrase => {
      const result = handler.detectSpecificAppointmentRequest(phrase);
      console.log(`  "${phrase}": ${result ? '✅ MATCHED (pattern ' + result.pattern + ')' : '❌ NOT MATCHED'}`);
    });
    
    // 3. Test actual booking
    console.log('\n3. TESTING ACTUAL BOOKING:');
    
    // Create a test appointment for tomorrow at 10 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    
    console.log('Attempting to book:', tomorrow.toLocaleString());
    
    const bookingResult = await autoBookAppointment(
      'Test Customer',
      'test@example.com',
      '+1234567890',
      tomorrow,
      { test: true }
    );
    
    console.log('\nBooking result:', bookingResult.success ? '✅ SUCCESS' : '❌ FAILED');
    if (bookingResult.success) {
      console.log('Event ID:', bookingResult.eventId);
      console.log('Meeting link:', bookingResult.meetingLink);
    } else {
      console.log('Error:', bookingResult.error);
    }
    
  } catch (error) {
    console.error('❌ Debug error:', error.message);
    console.error(error.stack);
  }
}

// Run the debug
debugCalendarBooking();
