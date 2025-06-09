// calendar-debug.js - Place this in your PROJECT ROOT directory (same level as package.json)
require('dotenv').config();

async function debugCalendarSetup() {
  console.log('🔍 DEBUGGING GOOGLE CALENDAR SETUP');
  console.log('=====================================');
  
  // 1. Check Environment Variables
  console.log('\n1. ENVIRONMENT VARIABLES:');
  console.log('GOOGLE_PROJECT_ID:', process.env.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING');
  console.log('GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING');
  console.log('GOOGLE_CLIENT_EMAIL:', process.env.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING');
  console.log('GOOGLE_CALENDAR_ID:', process.env.GOOGLE_CALENDAR_ID || 'primary (default)');
  
  if (process.env.GOOGLE_PRIVATE_KEY) {
    console.log('Private Key Length:', process.env.GOOGLE_PRIVATE_KEY.length);
    console.log('Private Key Format:', process.env.GOOGLE_PRIVATE_KEY.includes('-----BEGIN PRIVATE KEY-----') ? '✅ VALID' : '❌ INVALID');
  }
  
  if (!process.env.GOOGLE_PROJECT_ID || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_CLIENT_EMAIL) {
    console.log('\n❌ Missing required Google Calendar environment variables!');
    console.log('\n📋 Required Environment Variables:');
    console.log('GOOGLE_PROJECT_ID=your-project-id');
    console.log('GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...your private key...\\n-----END PRIVATE KEY-----\\n"');
    console.log('GOOGLE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com');
    console.log('GOOGLE_CALENDAR_ID=primary');
    console.log('\n🔗 Setup Guide: https://developers.google.com/calendar/api/quickstart/nodejs');
    return;
  }
  
  // 2. Test Calendar Service Initialization
  console.log('\n2. TESTING CALENDAR SERVICE:');
  try {
    const { initializeCalendarService, isCalendarInitialized } = require('./src/services/calendar/CalendarHelpers');
    
    console.log('Attempting calendar initialization...');
    const initialized = await initializeCalendarService();
    console.log('Calendar Initialization:', initialized ? '✅ SUCCESS' : '❌ FAILED');
    console.log('Calendar Status:', isCalendarInitialized() ? '✅ READY' : '❌ NOT READY');
    
    if (!initialized) {
      console.log('❌ Calendar service failed to initialize');
      console.log('💡 Common issues:');
      console.log('   - Service account not created properly');
      console.log('   - Calendar API not enabled');
      console.log('   - Private key format incorrect');
      console.log('   - Calendar not shared with service account');
      return;
    }
    
  } catch (error) {
    console.log('❌ Calendar initialization error:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Check your Google Cloud Console project');
    console.log('2. Ensure Calendar API is enabled');
    console.log('3. Verify service account credentials');
    console.log('4. Check private key format (should include \\n for newlines)');
    return;
  }
  
  // 3. Test Getting Available Slots
  console.log('\n3. TESTING AVAILABLE SLOTS:');
  try {
    const { getAvailableTimeSlots } = require('./src/services/calendar/CalendarHelpers');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log(`Getting slots for: ${tomorrow.toDateString()}`);
    const slots = await getAvailableTimeSlots(tomorrow);
    console.log(`Available slots found: ${slots.length}`);
    
    if (slots.length > 0) {
      console.log('✅ Sample available slots:');
      slots.slice(0, 5).forEach((slot, i) => {
        console.log(`   ${i + 1}. ${slot.displayTime} Arizona MST`);
        console.log(`      UTC: ${slot.startTime}`);
      });
    } else {
      console.log('⚠️ No available slots found');
      console.log('   Possible reasons:');
      console.log('   - Calendar is fully booked');
      console.log('   - Business hours configuration issue');
      console.log('   - Weekend or non-business day');
    }
    
  } catch (error) {
    console.log('❌ Error getting available slots:', error.message);
  }
  
  // 4. Test Calendar Event Creation
  console.log('\n4. TESTING EVENT CREATION:');
  try {
    const { autoBookAppointment } = require('./src/services/calendar/CalendarHelpers');
    
    // Create a test appointment 2 days from now at 10 AM
    const testDate = new Date();
    testDate.setDate(testDate.getDate() + 2);
    testDate.setHours(10, 0, 0, 0);
    
    console.log(`Testing appointment creation for: ${testDate.toLocaleString('en-US', { timeZone: 'America/Phoenix' })} Arizona MST`);
    console.log('UTC representation:', testDate.toISOString());
    
    const result = await autoBookAppointment(
      'Test Customer', 
      'test@example.com', 
      '+1234567890',
      testDate,
      { 
        test: 'This is a test booking',
        source: 'Calendar debug script',
        timestamp: new Date().toISOString()
      }
    );
    
    console.log('\n📅 Booking test result:');
    console.log('Success:', result.success);
    
    if (result.success) {
      console.log('✅ CALENDAR BOOKING TEST SUCCESSFUL!');
      console.log('   Event ID:', result.eventId);
      console.log('   Meeting Link:', result.meetingLink || 'None generated');
      console.log('   Event Link:', result.eventLink || 'None available');
      console.log('   Display Time:', result.displayTime);
      console.log('   Timezone:', result.timezone);
      console.log('\n🎉 Your calendar integration is working perfectly!');
      console.log('📧 A test event was created and invitation sent to test@example.com');
    } else {
      console.log('❌ CALENDAR BOOKING TEST FAILED');
      console.log('   Error:', result.error);
      console.log('   Message:', result.message);
      
      console.log('\n🔧 Possible solutions:');
      console.log('   - Check calendar permissions');
      console.log('   - Verify service account has calendar access');
      console.log('   - Ensure Calendar API quotas are not exceeded');
    }
    
  } catch (error) {
    console.log('❌ Error testing event creation:', error.message);
    console.log('Stack trace:', error.stack);
  }
  
  // 5. Check Webhook Integration
  console.log('\n5. WEBHOOK INTEGRATION STATUS:');
  console.log('TRIGGER_SERVER_URL:', process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com (default)');
  console.log('N8N_WEBHOOK_URL:', process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling (default)');
  
  // 6. Test Webhook Sending
  console.log('\n6. TESTING WEBHOOK:');
  try {
    const { sendSchedulingPreference } = require('./src/services/webhooks/WebhookService');
    
    const webhookResult = await sendSchedulingPreference(
      'Test Customer',
      'test@example.com',
      '+1234567890',
      'Test appointment - debug script',
      'debug_call_' + Date.now(),
      {
        'How did you hear about us': 'Debug script test',
        'Business/Industry': 'Software Testing',
        'Main product': 'Calendar Integration',
        'Running ads': 'No',
        'Using CRM': 'Testing',
        'Pain points': 'Calendar booking issues',
        test_mode: true,
        debug_script: true
      }
    );
    
    console.log('Webhook test result:');
    console.log('   Success:', webhookResult.success);
    if (webhookResult.success) {
      console.log('✅ Webhook test successful!');
    } else {
      console.log('❌ Webhook test failed:', webhookResult.error);
    }
    
  } catch (error) {
    console.log('❌ Error testing webhook:', error.message);
  }
  
  console.log('\n🎯 DEBUG SUMMARY:');
  console.log('================');
  console.log('If all tests passed, your calendar integration should work automatically.');
  console.log('If any tests failed, check the error messages above for guidance.');
  console.log('\n📚 Additional Resources:');
  console.log('- Google Calendar API Docs: https://developers.google.com/calendar/api');
  console.log('- Service Account Setup: https://cloud.google.com/iam/docs/service-accounts');
  console.log('- Calendar Sharing: https://support.google.com/calendar/answer/37082');
  
  console.log('\n✅ Debug complete! Check the results above.');
}

// Run the debug if this file is executed directly
if (require.main === module) {
  debugCalendarSetup().catch(console.error);
}

module.exports = debugCalendarSetup;
