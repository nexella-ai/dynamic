// test-components.js - Test each component individually
require('dotenv').config();

async function testComponents() {
  console.log('🧪 Testing Nexella AI Components\n');
  
  const results = {
    calendar: false,
    memory: false,
    booking: false,
    webhook: false
  };
  
  // 1. Test Calendar
  console.log('1️⃣ Testing Calendar Service...');
  try {
    const { isCalendarInitialized, getAvailableTimeSlots } = require('./src/services/calendar/CalendarHelpers');
    results.calendar = isCalendarInitialized();
    
    if (results.calendar) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const slots = await getAvailableTimeSlots(tomorrow);
      console.log(`✅ Calendar working! Found ${slots.length} slots for tomorrow`);
    } else {
      console.log('❌ Calendar not initialized');
    }
  } catch (error) {
    console.log('❌ Calendar error:', error.message);
  }
  
  // 2. Test Memory Service
  console.log('\n2️⃣ Testing Memory Service...');
  try {
    const RAGMemoryService = require('./src/services/memory/RAGMemoryService');
    const memory = new RAGMemoryService();
    const stats = await memory.getMemoryStats();
    results.memory = true;
    console.log('✅ Memory service working!', stats);
  } catch (error) {
    console.log('❌ Memory error:', error.message);
  }
  
  // 3. Test Booking Manager
  console.log('\n3️⃣ Testing Booking Manager...');
  try {
    const BookingManager = require('./src/services/booking/BookingManager');
    const booking = new BookingManager({
      customerEmail: 'test@example.com',
      firstName: 'Test',
      lastName: 'User'
    });
    results.booking = true;
    console.log('✅ Booking manager initialized!');
  } catch (error) {
    console.log('❌ Booking error:', error.message);
  }
  
  // 4. Test Webhook
  console.log('\n4️⃣ Testing Webhook Service...');
  try {
    const { sendSchedulingPreference } = require('./src/services/webhooks/WebhookService');
    // Don't actually send, just check if function exists
    results.webhook = typeof sendSchedulingPreference === 'function';
    console.log('✅ Webhook service available!');
  } catch (error) {
    console.log('❌ Webhook error:', error.message);
  }
  
  // Summary
  console.log('\n📊 COMPONENT TEST SUMMARY:');
  console.log('==========================');
  Object.entries(results).forEach(([component, status]) => {
    console.log(`${component.padEnd(10)}: ${status ? '✅ PASS' : '❌ FAIL'}`);
  });
  
  const passCount = Object.values(results).filter(v => v).length;
  console.log(`\nTotal: ${passCount}/4 components working`);
  
  if (passCount < 4) {
    console.log('\n⚠️  Some components are not working properly.');
    console.log('Check your environment variables and dependencies.');
  } else {
    console.log('\n🎉 All components are working!');
  }
}

// Run the tests
testComponents().catch(console.error);
