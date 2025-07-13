// test-calendar-init.js - Test if calendar service initializes properly
require('dotenv').config();

async function testCalendarInit() {
  console.log('🧪 TESTING CALENDAR INITIALIZATION\n');
  
  // 1. Check environment variables
  console.log('1️⃣ Checking environment variables:');
  const requiredVars = [
    'GOOGLE_PROJECT_ID',
    'GOOGLE_PRIVATE_KEY', 
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_CALENDAR_ID'
  ];
  
  let allVarsPresent = true;
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`✅ ${varName}: ${varName.includes('KEY') ? 'SET (hidden)' : value}`);
    } else {
      console.log(`❌ ${varName}: MISSING`);
      allVarsPresent = false;
    }
  });
  
  if (!allVarsPresent) {
    console.log('\n❌ Missing required environment variables!');
    console.log('Please set all required Google Calendar variables in your .env file');
    return;
  }
  
  // 2. Test initialization
  console.log('\n2️⃣ Testing calendar service initialization:');
  try {
    const { 
      initializeCalendarService, 
      isCalendarInitialized,
      getAvailableTimeSlots 
    } = require('./src/services/calendar/CalendarHelpers');
    
    console.log('Current status:', isCalendarInitialized() ? 'Already initialized' : 'Not initialized');
    
    if (!isCalendarInitialized()) {
      console.log('Initializing calendar service...');
      const result = await initializeCalendarService();
      console.log('Initialization result:', result ? '✅ SUCCESS' : '❌ FAILED');
    }
    
    // 3. Test getting available slots
    if (isCalendarInitialized()) {
      console.log('\n3️⃣ Testing available slots:');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const slots = await getAvailableTimeSlots(tomorrow);
      console.log(`Found ${slots.length} available slots for tomorrow`);
      
      if (slots.length > 0) {
        console.log('Sample slots:');
        slots.slice(0, 3).forEach(slot => {
          console.log(`  - ${slot.displayTime}`);
        });
      }
      
      // 4. Test booking
      console.log('\n4️⃣ Testing appointment booking:');
      const { autoBookAppointment } = require('./src/services/calendar/CalendarHelpers');
      
      const testDate = new Date();
      testDate.setDate(testDate.getDate() + 2);
      testDate.setHours(10, 0, 0, 0);
      
      console.log('Attempting test booking for:', testDate.toLocaleString());
      
      const bookingResult = await autoBookAppointment(
        'Test Customer',
        'test@example.com',
        '+1234567890',
        testDate,
        { test: true }
      );
      
      if (bookingResult.success) {
        console.log('✅ Booking successful!');
        console.log('Event ID:', bookingResult.eventId);
        
        // Clean up test event
        try {
          const { google } = require('googleapis');
          const { getCalendarService } = require('./src/services/calendar/CalendarHelpers');
          const calendarService = getCalendarService();
          const calendar = google.calendar({ version: 'v3', auth: calendarService.auth });
          
          await calendar.events.delete({
            calendarId: process.env.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
            eventId: bookingResult.eventId
          });
          console.log('🧹 Test event cleaned up');
        } catch (err) {
          console.log('⚠️ Could not clean up test event');
        }
      } else {
        console.log('❌ Booking failed:', bookingResult.error);
      }
    }
    
    console.log('\n✅ Calendar initialization test complete!');
    
  } catch (error) {
    console.error('\n❌ Error during testing:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testCalendarInit().catch(console.error);
