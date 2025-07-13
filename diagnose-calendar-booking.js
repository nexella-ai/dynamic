// diagnose-calendar-booking.js - Diagnose why calendar booking might be failing
require('dotenv').config();

async function diagnoseCalendarBooking() {
  console.log('🔍 DIAGNOSING CALENDAR BOOKING ISSUES\n');
  
  const { 
    isCalendarInitialized,
    initializeCalendarService,
    getAvailableTimeSlots,
    autoBookAppointment
  } = require('./src/services/calendar/CalendarHelpers');
  
  // Step 1: Check initialization
  console.log('1️⃣ Checking calendar initialization...');
  let initialized = isCalendarInitialized();
  console.log('Initial status:', initialized ? '✅ Initialized' : '❌ Not initialized');
  
  if (!initialized) {
    console.log('Attempting to initialize...');
    try {
      initialized = await initializeCalendarService();
      console.log('Initialization result:', initialized ? '✅ Success' : '❌ Failed');
    } catch (error) {
      console.log('❌ Initialization error:', error.message);
    }
  }
  
  if (!initialized) {
    console.log('\n❌ Calendar service cannot be initialized. Check your environment variables:');
    console.log('   GOOGLE_PROJECT_ID');
    console.log('   GOOGLE_PRIVATE_KEY');
    console.log('   GOOGLE_CLIENT_EMAIL');
    console.log('   GOOGLE_CALENDAR_ID');
    return;
  }
  
  // Step 2: Check available slots
  console.log('\n2️⃣ Checking available time slots...');
  const thursday = getNextThursday();
  console.log('Checking slots for:', thursday.toDateString());
  
  try {
    const slots = await getAvailableTimeSlots(thursday);
    console.log(`Found ${slots.length} available slots:`);
    slots.forEach(slot => {
      console.log(`  - ${slot.displayTime}: ${new Date(slot.startTime).toLocaleString()}`);
    });
    
    if (slots.length === 0) {
      console.log('❌ No available slots found. This might be why booking is failing.');
      return;
    }
    
    // Step 3: Try a test booking
    console.log('\n3️⃣ Attempting test booking...');
    const testSlot = slots[0];
    console.log('Using slot:', testSlot.displayTime);
    
    const bookingResult = await autoBookAppointment(
      'Test Customer',
      'test@example.com',
      '+1234567890',
      new Date(testSlot.startTime),
      { test: true, diagnostic: true }
    );
    
    console.log('\nBooking result:', bookingResult.success ? '✅ SUCCESS' : '❌ FAILED');
    if (bookingResult.success) {
      console.log('Event ID:', bookingResult.eventId);
      console.log('Meeting link:', bookingResult.meetingLink);
      
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
      console.log('Error:', bookingResult.error);
      console.log('Message:', bookingResult.message);
      
      console.log('\n🔧 Possible solutions:');
      console.log('1. Check if the calendar is shared with the service account');
      console.log('2. Verify the service account has "Make changes to events" permission');
      console.log('3. Check if there are any calendar quotas exceeded');
      console.log('4. Ensure the timezone settings are correct');
    }
    
  } catch (error) {
    console.log('❌ Error during diagnosis:', error.message);
    console.log('Stack:', error.stack);
  }
  
  // Step 4: Check email validation
  console.log('\n4️⃣ Checking email validation...');
  const testEmails = [
    '',
    'pending@halfpriceroof.com',
    'test@example.com',
    'prospect@example.com'
  ];
  
  for (const email of testEmails) {
    const isValid = email && email !== 'prospect@example.com';
    console.log(`Email "${email}": ${isValid ? '✅ Valid' : '❌ Invalid'}`);
  }
  
  console.log('\n✅ Diagnosis complete!');
}

function getNextThursday() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7; // Thursday is 4
  const thursday = new Date(today);
  thursday.setDate(today.getDate() + daysUntilThursday);
  thursday.setHours(9, 0, 0, 0); // 9 AM
  return thursday;
}

// Run the diagnosis
diagnoseCalendarBooking().catch(console.error);
