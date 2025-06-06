// COMPLETE server.js with enhanced Google Calendar integration - FULLY FIXED VERSION
require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');
const GoogleCalendarService = require('./google-calendar-service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Initialize Google Calendar service
const calendarService = new GoogleCalendarService();

// Ensure we have the required environment variables
if (!process.env.TRIGGER_SERVER_URL) {
  process.env.TRIGGER_SERVER_URL = 'https://trigger-server-qt7u.onrender.com';
}
if (!process.env.N8N_WEBHOOK_URL) {
  process.env.N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
}

// Store the latest Typeform submission for reference
global.lastTypeformSubmission = null;

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with Google Calendar integration is live!');
});

// Store active calls metadata
const activeCallsMetadata = new Map();

// ENHANCED: Helper function to store contact info globally
function storeContactInfoGlobally(name, email, phone, source = 'Unknown') {
  console.log(`📝 Storing contact info globally from ${source}:`, { name, email, phone });
  
  if (email && email.trim() !== '') {
    global.lastTypeformSubmission = {
      timestamp: new Date().toISOString(),
      email: email.trim(),
      name: (name || '').trim(),
      phone: (phone || '').trim(),
      source: source
    };
    console.log('✅ Stored contact info globally:', global.lastTypeformSubmission);
    return true;
  } else {
    console.warn('⚠️ Cannot store contact info - missing email');
    return false;
  }
}

// FIXED: Enhanced availability checking function
async function checkAvailability(startTime, endTime) {
  try {
    console.log('🔍 Checking availability via calendar service...');
    console.log('⏰ Start time:', startTime);
    console.log('⏰ End time:', endTime);
    
    const available = await calendarService.isSlotAvailable(startTime, endTime);
    console.log('📊 Calendar service result:', available);
    
    return available;
  } catch (error) {
    console.error('❌ Error checking availability:', error.message);
    // Fallback: assume available if calendar check fails
    console.log('⚠️ Falling back to assuming slot is available');
    return true;
  }
}

// FIXED: Enhanced function to get available time slots
async function getAvailableTimeSlots(date) {
  try {
    console.log('📅 Getting available slots for:', date);
    
    const availableSlots = await calendarService.getAvailableSlots(date);
    console.log(`📋 Calendar service returned ${availableSlots.length} slots`);
    
    // Log first few slots for debugging
    if (availableSlots.length > 0) {
      console.log('📋 Sample available slots:');
      availableSlots.slice(0, 3).forEach((slot, index) => {
        console.log(`   ${index + 1}. ${slot.displayTime} (${slot.dateTime})`);
      });
    }
    
    return availableSlots;
  } catch (error) {
    console.error('❌ Error getting available slots:', error.message);
    return [];
  }
}

// Enhanced function to get and format available slots for user
async function getFormattedAvailableSlots(startDate = null, daysAhead = 7) {
  try {
    const today = new Date();
    const searchStart = startDate ? new Date(startDate) : today;
    
    console.log(`📅 Getting formatted available slots starting from: ${searchStart.toDateString()}`);
    
    const allAvailableSlots = [];
    
    for (let i = 0; i < daysAhead; i++) {
      const checkDate = new Date(searchStart);
      checkDate.setDate(searchStart.getDate() + i);
      
      // Skip if date is in the past
      if (checkDate < today) continue;
      
      const slots = await getAvailableTimeSlots(checkDate);
      
      if (slots.length > 0) {
        const dayName = checkDate.toLocaleDateString('en-US', { 
          weekday: 'long',
          month: 'long', 
          day: 'numeric'
        });
        
        allAvailableSlots.push({
          date: checkDate.toDateString(),
          dayName: dayName,
          slots: slots.slice(0, 4), // Show up to 4 slots per day
          formattedSlots: slots.slice(0, 4).map(slot => slot.displayTime).join(', ')
        });
      }
    }
    
    console.log(`✅ Found available slots across ${allAvailableSlots.length} days`);
    return allAvailableSlots;
    
  } catch (error) {
    console.error('❌ Error getting formatted available slots:', error.message);
    return [];
  }
}

// Enhanced function to generate availability response for user
async function generateAvailabilityResponse() {
  try {
    const availableSlots = await getFormattedAvailableSlots();
    
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
    availableSlots.slice(0, 3).forEach((day, index) => {
      if (index === 0) {
        response += `${day.dayName} at ${day.formattedSlots}`;
      } else if (index === availableSlots.length - 1 || index === 2) {
        response += `, or ${day.dayName} at ${day.formattedSlots}`;
      } else {
        response += `, ${day.dayName} at ${day.formattedSlots}`;
      }
    });
    response += ". Which day and time would work best for you?";
    
    return response;
    
  } catch (error) {
    console.error('❌ Error generating availability response:', error.message);
    return "Let me check my calendar and get back to you with some available times.";
  }
}

// Function to format a date range for display
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

// Function to validate business hours
function isBusinessHours(dateTime) {
  const date = new Date(dateTime);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = date.getHours();
  
  // Monday to Friday (1-5), 9 AM to 5 PM
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour < 17;
}

// Function to get next business day
function getNextBusinessDay(fromDate = new Date()) {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + 1);
  
  while (date.getDay() === 0 || date.getDay() === 6) { // Skip weekends
    date.setDate(date.getDate() + 1);
  }
  
  return date;
}

// Update conversation state in trigger server
async function updateConversationState(callId, discoveryComplete, preferredDay) {
  try {
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/update-conversation`, {
      call_id: callId,
      discoveryComplete,
      preferredDay
    });
    console.log(`Updated conversation state for call ${callId}:`, response.data);
    return response.data.success;
  } catch (error) {
    console.error('Error updating conversation state:', error);
    return false;
  }
}

// FIXED: Enhanced scheduling preference detection
function handleSchedulingPreference(userMessage) {
  console.log('🔍 Analyzing user message for scheduling:', userMessage);
  
  // Enhanced regex patterns for better day/time detection
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

// FIXED: Enhanced function to suggest alternative times
async function suggestAlternativeTime(preferredDate, userMessage) {
  try {
    const availableSlots = await getAvailableTimeSlots(preferredDate);
    
    if (availableSlots.length === 0) {
      // Try next day
      const nextDay = new Date(preferredDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDaySlots = await getAvailableTimeSlots(nextDay);
      
      if (nextDaySlots.length > 0) {
        const nextDayName = nextDay.toLocaleDateString('en-US', { weekday: 'long' });
        return `I don't have any availability that day. How about ${nextDayName} at ${nextDaySlots[0].displayTime}?`;
      } else {
        return "Let me check my calendar for the best available times this week and get back to you.";
      }
    }
    
    if (availableSlots.length === 1) {
      return `I have ${availableSlots[0].displayTime} available that day. Does that work for you?`;
    } else if (availableSlots.length >= 2) {
      return `I have a few times available that day: ${availableSlots[0].displayTime} or ${availableSlots[1].displayTime}. Which would you prefer?`;
    }
    
    return "Let me check what times I have available and get back to you.";
  } catch (error) {
    console.error('Error suggesting alternative time:', error);
    return "Let me check my calendar and find some good times for our meeting.";
  }
}

// ENHANCED: Send scheduling data with Google Calendar booking
async function sendSchedulingPreference(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    console.log('=== ENHANCED WEBHOOK SENDING DEBUG ===');
    console.log('Input parameters:', { name, email, phone, preferredDay, callId });
    console.log('Raw discovery data input:', JSON.stringify(discoveryData, null, 2));
    console.log('Discovery data keys:', Object.keys(discoveryData));
    console.log('Global Typeform submission:', global.lastTypeformSubmission);
    
    // Enhanced email retrieval with multiple fallbacks
    let finalEmail = email;
    let finalName = name;
    let finalPhone = phone;
    
    if (finalEmail && finalEmail.trim() !== '') {
      console.log(`Using provided email: ${finalEmail}`);
    } else if (global.lastTypeformSubmission && global.lastTypeformSubmission.email) {
      finalEmail = global.lastTypeformSubmission.email;
      console.log(`Using email from global Typeform: ${finalEmail}`);
    } else if (callId && activeCallsMetadata.has(callId)) {
      const callMetadata = activeCallsMetadata.get(callId);
      if (callMetadata && callMetadata.customer_email) {
        finalEmail = callMetadata.customer_email;
        console.log(`Using email from call metadata: ${finalEmail}`);
      }
    }
    
    // Enhanced name and phone retrieval
    if (!finalName || finalName.trim() === '') {
      if (global.lastTypeformSubmission && global.lastTypeformSubmission.name) {
        finalName = global.lastTypeformSubmission.name;
      } else if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        if (callMetadata && callMetadata.customer_name) {
          finalName = callMetadata.customer_name;
        }
      }
    }
    
    if (!finalPhone || finalPhone.trim() === '') {
      if (global.lastTypeformSubmission && global.lastTypeformSubmission.phone) {
        finalPhone = global.lastTypeformSubmission.phone;
      } else if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        if (callMetadata && (callMetadata.phone || callMetadata.to_number)) {
          finalPhone = callMetadata.phone || callMetadata.to_number;
        }
      }
    }
    
    console.log(`Final contact info - Email: "${finalEmail}", Name: "${finalName}", Phone: "${finalPhone}"`);
    
    if (!finalEmail || finalEmail.trim() === '') {
      console.error('❌ CRITICAL: No email found from any source. Cannot send webhook.');
      return { success: false, error: 'No email address available' };
    }

    // ENHANCED: Process discovery data with better field mapping
    console.log('🔧 PROCESSING DISCOVERY DATA:');
    console.log('Raw discoveryData input:', JSON.stringify(discoveryData, null, 2));
    
    const formattedDiscoveryData = {};
    
    const fieldMappings = {
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry', 
      'question_2': 'Main product',
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
    };
    
    Object.entries(discoveryData).forEach(([key, value]) => {
      console.log(`🔧 Processing key: "${key}" with value: "${value}"`);
      
      if (value && typeof value === 'string' && value.trim() !== '') {
        const trimmedValue = value.trim();
        
        if (key.startsWith('question_') && fieldMappings[key]) {
          formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          console.log(`✅ Mapped ${key} -> "${fieldMappings[key]}" = "${trimmedValue}"`);
        } else if (key === 'How did you hear about us' || key.includes('hear about')) {
          formattedDiscoveryData['How did you hear about us'] = trimmedValue;
          console.log(`✅ Direct mapping: How did you hear about us = "${trimmedValue}"`);
        } else if (key === 'Business/Industry' || key.includes('business') || key.includes('industry')) {
          if (!formattedDiscoveryData['Business/Industry']) {
            formattedDiscoveryData['Business/Industry'] = trimmedValue;
            console.log(`✅ Direct mapping: Business/Industry = "${trimmedValue}"`);
          }
        } else if (key === 'Main product' || key.includes('product')) {
          if (!formattedDiscoveryData['Main product']) {
            formattedDiscoveryData['Main product'] = trimmedValue;
            console.log(`✅ Direct mapping: Main product = "${trimmedValue}"`);
          }
        } else if (key === 'Running ads' || key.includes('ads') || key.includes('advertising')) {
          if (!formattedDiscoveryData['Running ads']) {
            formattedDiscoveryData['Running ads'] = trimmedValue;
            console.log(`✅ Direct mapping: Running ads = "${trimmedValue}"`);
          }
        } else if (key === 'Using CRM' || key.includes('crm')) {
          if (!formattedDiscoveryData['Using CRM']) {
            formattedDiscoveryData['Using CRM'] = trimmedValue;
            console.log(`✅ Direct mapping: Using CRM = "${trimmedValue}"`);
          }
        } else if (key === 'Pain points' || key.includes('pain') || key.includes('problem') || key.includes('challenge')) {
          if (!formattedDiscoveryData['Pain points']) {
            formattedDiscoveryData['Pain points'] = trimmedValue;
            console.log(`✅ Direct mapping: Pain points = "${trimmedValue}"`);
          }
        } else {
          formattedDiscoveryData[key] = trimmedValue;
          console.log(`📝 Keeping original key: ${key} = "${trimmedValue}"`);
        }
      }
    });
    
    console.log('🔧 FINAL FORMATTED DISCOVERY DATA:', JSON.stringify(formattedDiscoveryData, null, 2));
    console.log('📊 Total discovery fields captured:', Object.keys(formattedDiscoveryData).length);
    
    // Ensure phone number is formatted properly
    if (finalPhone && !finalPhone.startsWith('+')) {
      finalPhone = '+1' + finalPhone.replace(/[^0-9]/g, '');
    }

    // ENHANCED: Google Calendar booking logic
    let bookingResult = null;
    let meetingDetails = null;

    if (preferredDay && preferredDay !== 'Call ended early' && preferredDay !== 'Error occurred') {
      try {
        console.log('📅 Attempting to book Google Calendar appointment...');
        
        // Parse the preferred day/time
        const timePreference = calendarService.parseTimePreference('', preferredDay);
        console.log('⏰ Parsed time preference:', timePreference);
        
        // Get available slots for the preferred day
        const availableSlots = await getAvailableTimeSlots(timePreference.preferredDateTime);
        console.log(`📋 Found ${availableSlots.length} available slots`);
        
        if (availableSlots.length > 0) {
          // Use the first available slot closest to their preference
          const selectedSlot = availableSlots[0];
          
          // Create the calendar event
          bookingResult = await calendarService.createEvent({
            summary: 'Nexella AI Consultation Call',
            description: `Discovery call with ${finalName}\n\nDiscovery Notes:\n${Object.entries(formattedDiscoveryData).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
            startTime: selectedSlot.startTime,
            endTime: selectedSlot.endTime,
            attendeeEmail: finalEmail,
            attendeeName: finalName
          });
          
          if (bookingResult.success) {
            meetingDetails = {
              eventId: bookingResult.eventId,
              meetingLink: bookingResult.meetingLink,
              eventLink: bookingResult.eventLink,
              startTime: selectedSlot.startTime,
              endTime: selectedSlot.endTime,
              displayTime: selectedSlot.displayTime
            };
            console.log('✅ Calendar event created successfully:', meetingDetails);
          }
        }
      } catch (calendarError) {
        console.error('❌ Error booking calendar appointment:', calendarError);
      }
    }
    
    // Create the webhook payload
    const webhookData = {
      name: finalName || '',
      email: finalEmail,
      phone: finalPhone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData,
      formatted_discovery: formattedDiscoveryData,
      // Google Calendar specific fields
      calendar_booking: bookingResult?.success || false,
      meeting_link: meetingDetails?.meetingLink || '',
      event_link: meetingDetails?.eventLink || '',
      event_id: meetingDetails?.eventId || '',
      scheduled_time: meetingDetails?.startTime || '',
      // Individual fields for direct access
      "How did you hear about us": formattedDiscoveryData["How did you hear about us"] || '',
      "Business/Industry": formattedDiscoveryData["Business/Industry"] || '',
      "Main product": formattedDiscoveryData["Main product"] || '',
      "Running ads": formattedDiscoveryData["Running ads"] || '',
      "Using CRM": formattedDiscoveryData["Using CRM"] || '',
      "Pain points": formattedDiscoveryData["Pain points"] || ''
    };
    
    console.log('📤 COMPLETE WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    console.log('✅ Sending scheduling preference to trigger server');
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Scheduling preference sent successfully:', response.data);
    return { 
      success: true, 
      data: response.data,
      booking: bookingResult,
      meetingDetails
    };

  } catch (error) {
    console.error('❌ Error sending scheduling preference:', error);
    
    // Enhanced fallback to n8n with same data processing
    try {
      console.log('🔄 Attempting to send directly to n8n webhook as fallback');
      const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
      
      let fallbackEmail = email || (global.lastTypeformSubmission && global.lastTypeformSubmission.email) || '';
      let fallbackName = name || (global.lastTypeformSubmission && global.lastTypeformSubmission.name) || '';
      let fallbackPhone = phone || (global.lastTypeformSubmission && global.lastTypeformSubmission.phone) || '';
      
      if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        fallbackEmail = fallbackEmail || callMetadata?.customer_email || '';
        fallbackName = fallbackName || callMetadata?.customer_name || '';
        fallbackPhone = fallbackPhone || callMetadata?.phone || callMetadata?.to_number || '';
      }
      
      // Process discovery data for fallback (same logic)
      const formattedDiscoveryData = {};
      const fieldMappings = {
        'question_0': 'How did you hear about us',
        'question_1': 'Business/Industry',
        'question_2': 'Main product',
        'question_3': 'Running ads',
        'question_4': 'Using CRM',
        'question_5': 'Pain points'
      };
      
      Object.entries(discoveryData).forEach(([key, value]) => {
        if (value && typeof value === 'string' && value.trim() !== '') {
          const trimmedValue = value.trim();
          if (key.startsWith('question_') && fieldMappings[key]) {
            formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          } else if (key === 'How did you hear about us' || key.includes('hear about')) {
            formattedDiscoveryData['How did you hear about us'] = trimmedValue;
          } else if (key === 'Business/Industry' || key.includes('business') || key.includes('industry')) {
            formattedDiscoveryData['Business/Industry'] = trimmedValue;
          } else if (key === 'Main product' || key.includes('product')) {
            formattedDiscoveryData['Main product'] = trimmedValue;
          } else if (key === 'Running ads' || key.includes('ads')) {
            formattedDiscoveryData['Running ads'] = trimmedValue;
          } else if (key === 'Using CRM' || key.includes('crm')) {
            formattedDiscoveryData['Using CRM'] = trimmedValue;
          } else if (key === 'Pain points' || key.includes('pain') || key.includes('problem')) {
            formattedDiscoveryData['Pain points'] = trimmedValue;
          } else {
            formattedDiscoveryData[key] = trimmedValue;
          }
        }
      });
      
      const fallbackWebhookData = {
        name: fallbackName,
        email: fallbackEmail,
        phone: fallbackPhone,
        preferredDay: preferredDay || '',
        call_id: callId || '',
        schedulingComplete: true,
        discovery_data: formattedDiscoveryData,
        formatted_discovery: formattedDiscoveryData,
        calendar_booking: false, // Failed to book
        "How did you hear about us": formattedDiscoveryData["How did you hear about us"] || '',
        "Business/Industry": formattedDiscoveryData["Business/Industry"] || '',
        "Main product": formattedDiscoveryData["Main product"] || '',
        "Running ads": formattedDiscoveryData["Running ads"] || '',
        "Using CRM": formattedDiscoveryData["Using CRM"] || '',
        "Pain points": formattedDiscoveryData["Pain points"] || ''
      };
      
      console.log('🔄 Fallback webhook data:', JSON.stringify(fallbackWebhookData, null, 2));
      
      const n8nResponse = await axios.post(n8nWebhookUrl, fallbackWebhookData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      console.log('✅ Successfully sent directly to n8n:', n8nResponse.data);
      return { success: true, fallback: true };
      
    } catch (n8nError) {
      console.error('❌ Error sending directly to n8n:', n8nError);
      return { success: false, error: error.message };
    }
  }
}

// HTTP Request - Trigger Retell Call
app.post('/trigger-retell-call', express.json(), async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    console.log(`Received request to trigger Retell call for ${name} (${email})`);
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    const userIdentifier = userId || `user_${phone || Date.now()}`;
    console.log('Call request data:', { name, email, phone, userIdentifier });
    
    storeContactInfoGlobally(name, email, phone, 'API Call');
    
    const metadata = {
      customer_name: name || '',
      customer_email: email,
      customer_phone: phone || ''
    };
    
    console.log('Setting up call with metadata:', metadata);
    
    const initialVariables = {
      customer_name: name || '',
      customer_email: email
    };
    
    const response = await axios.post('https://api.retellai.com/v1/calls', 
      {
        agent_id: process.env.RETELL_AGENT_ID,
        customer_number: phone,
        variables: initialVariables,
        metadata
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Successfully triggered Retell call: ${response.data.call_id}`);
    res.status(200).json({ 
      success: true, 
      call_id: response.data.call_id,
      message: `Call initiated for ${name || email}`
    });
    
  } catch (error) {
    console.error('Error triggering Retell call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Unknown error triggering call' 
    });
  }
});

// ENHANCED WEBSOCKET CONNECTION HANDLER
wss.on('connection', async (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION ESTABLISHED');
  console.log('Connection URL:', req.url);
  
  const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
  const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
  
  console.log('📞 Extracted Call ID:', callId);
  
  const connectionData = {
    callId: callId,
    metadata: null,
    customerEmail: null,
    customerName: null,
    customerPhone: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };

  let answerCaptureTimer = null;
  let userResponseBuffer = [];
  let isCapturingAnswer = false;

  if (callId) {
    try {
      console.log('🔍 Fetching metadata for call:', callId);
      const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
      
      const possibleEndpoints = [
        `${TRIGGER_SERVER_URL}/api/get-call-data/${callId}`,
        `${TRIGGER_SERVER_URL}/get-call-info/${callId}`,
        `${TRIGGER_SERVER_URL}/call-data/${callId}`,
        `${TRIGGER_SERVER_URL}/api/call/${callId}`
      ];
      
      let metadataFetched = false;
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying endpoint: ${endpoint}`);
          const response = await fetch(endpoint, { 
            timeout: 3000,
            headers: {
              'Content-Type': 'application/json'
            }
          });
          if (response.ok) {
            const callData = await response.json();
            console.log('📋 Retrieved call metadata:', callData);
            
            const actualData = callData.data || callData;
            connectionData.metadata = actualData;
            
            connectionData.customerEmail = actualData.email || actualData.customer_email || actualData.user_email || 
                                         (actualData.metadata && actualData.metadata.customer_email);
            connectionData.customerName = actualData.name || actualData.customer_name || actualData.user_name ||
                                        (actualData.metadata && actualData.metadata.customer_name);
            connectionData.customerPhone = actualData.phone || actualData.customer_phone || actualData.to_number ||
                                         (actualData.metadata && actualData.metadata.customer_phone);
            
            console.log('📧 Extracted from metadata:', {
              email: connectionData.customerEmail,
              name: connectionData.customerName,
              phone: connectionData.customerPhone
            });
            
            if (callData.call_type === 'appointment_confirmation') {
              connectionData.isAppointmentConfirmation = true;
              console.log('📅 This is an APPOINTMENT CONFIRMATION call');
            }
            
            metadataFetched = true;
            break;
          }
        } catch (endpointError) {
          console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
        }
      }
      
      if (!metadataFetched) {
        console.log('⚠️ Could not fetch metadata from any endpoint - will try to get from WebSocket messages');
      }
      
    } catch (error) {
      console.log('❌ Error fetching call metadata:', error.message);
      console.log('🔄 Will extract data from WebSocket messages instead');
    }
  }
  
  console.log('Retell connected via WebSocket.');

  // ENHANCED Discovery Questions System
  const discoveryQuestions = [
    { question: 'How did you hear about us?', field: 'How did you hear about us', asked: false, answered: false, answer: '' },
    { question: 'What industry or business are you in?', field: 'Business/Industry', asked: false, answered: false, answer: '' },
    { question: 'What\'s your main product or service?', field: 'Main product', asked: false, answered: false, answer: '' },
    { question: 'Are you currently running any ads?', field: 'Running ads', asked: false, answered: false, answer: '' },
    { question: 'Are you using any CRM system?', field: 'Using CRM', asked: false, answered: false, answer: '' },
    { question: 'What are your biggest pain points or challenges?', field: 'Pain points', asked: false, answered: false, answer: '' }
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: -1,
    questionsCompleted: 0,
    allQuestionsCompleted: false,
    waitingForAnswer: false,
    lastAcknowledgment: ''
  };

  function getContextualAcknowledgment(userAnswer, questionIndex) {
    const answer = userAnswer.toLowerCase();
    
    switch (questionIndex) {
      case 0:
        if (answer.includes('instagram') || answer.includes('social media')) {
          return "Instagram, nice! Social media is huge these days.";
        } else if (answer.includes('google') || answer.includes('search')) {
          return "Found us through Google, perfect.";
        } else if (answer.includes('referral') || answer.includes('friend') || answer.includes('recommend')) {
          return "Word of mouth referrals are the best!";
        } else {
          return "Great, thanks for sharing that.";
        }
        
      case 1:
        if (answer.includes('solar')) {
          return "Solar industry, that's awesome! Clean energy is the future.";
        } else if (answer.includes('real estate') || answer.includes('property')) {
          return "Real estate, excellent! That's a great market.";
        } else if (answer.includes('healthcare') || answer.includes('medical')) {
          return "Healthcare, wonderful! Such important work.";
        } else if (answer.includes('restaurant') || answer.includes('food')) {
          return "Food industry, nice! Everyone loves good food.";
        } else if (answer.includes('fitness') || answer.includes('gym')) {
          return "Fitness industry, fantastic! Health is so important.";
        } else if (answer.includes('e-commerce') || answer.includes('online')) {
          return "E-commerce, perfect! Online business is booming.";
        } else {
          return `So you're in the ${answer.split(' ')[0]} industry, that's great.`;
        }
        
      case 2:
        if (answer.includes('solar')) {
          return "Solar installations, excellent choice for the market.";
        } else if (answer.includes('coaching') || answer.includes('consulting')) {
          return "Coaching services, that's valuable work.";
        } else if (answer.includes('software') || answer.includes('app')) {
          return "Software solutions, perfect for today's market.";
        } else {
          return "Got it, that sounds like a great service.";
        }
        
      case 3:
        if (answer.includes('yes') || answer.includes('google') || answer.includes('facebook') || answer.includes('meta')) {
          return "Great, so you're already running ads. That's smart.";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "No ads currently, that's totally fine.";
        } else {
          return "Got it, thanks for that info.";
        }
        
      case 4:
        if (answer.includes('gohighlevel') || answer.includes('go high level')) {
          return "GoHighLevel, excellent choice! That's a powerful platform.";
        } else if (answer.includes('hubspot')) {
          return "HubSpot, nice! That's a solid CRM.";
        } else if (answer.includes('salesforce')) {
          return "Salesforce, perfect! The industry standard.";
        } else if (answer.includes('yes')) {
          return "Great, having a CRM system is really important.";
        } else if (answer.includes('no') || answer.includes('not')) {
          return "No CRM currently, that's actually pretty common.";
        } else {
          return "Perfect, I understand.";
        }
        
      case 5:
        if (answer.includes('lead') || answer.includes('follow up')) {
          return "Lead follow-up challenges, I totally get that.";
        } else if (answer.includes('time') || answer.includes('busy')) {
          return "Time management issues, that's so common in business.";
        } else if (answer.includes('money') || answer.includes('expensive')) {
          return "Budget concerns, completely understandable.";
        } else {
          return "I see, those are definitely real challenges.";
        }
        
      default:
        return "Perfect, thank you.";
    }
  }

  function detectQuestionAsked(botMessage) {
    const botContent = botMessage.toLowerCase();
    
    const nextQuestionIndex = discoveryQuestions.findIndex(q => !q.asked);
    
    if (nextQuestionIndex === -1) {
      console.log('✅ All questions have been asked');
      return false;
    }
    
    if (discoveryProgress.waitingForAnswer) {
      console.log(`⚠️ Already waiting for answer to question ${discoveryProgress.currentQuestionIndex + 1} - ignoring detection`);
      return false;
    }
    
    const nextQuestion = discoveryQuestions[nextQuestionIndex];
    let detected = false;
    
    switch (nextQuestionIndex) {
      case 0:
        detected = botContent.includes('hear about') || botContent.includes('find us') || botContent.includes('found us');
        break;
      case 1:
        detected = (botContent.includes('industry') || botContent.includes('business')) && !botContent.includes('hear about');
        break;
      case 2:
        detected = (botContent.includes('product') || botContent.includes('service')) && !botContent.includes('industry');
        break;
      case 3:
        detected = (botContent.includes('running') && botContent.includes('ads')) || botContent.includes('advertising');
        break;
      case 4:
        detected = botContent.includes('crm') || (botContent.includes('using') && botContent.includes('system'));
        break;
      case 5:
        detected = botContent.includes('pain point') || botContent.includes('challenge') || botContent.includes('biggest');
        break;
    }
    
    if (detected) {
      console.log(`✅ DETECTED Question ${nextQuestionIndex + 1}: "${nextQuestion.question}"`);
      nextQuestion.asked = true;
      discoveryProgress.currentQuestionIndex = nextQuestionIndex;
      discoveryProgress.waitingForAnswer = true;
      userResponseBuffer = [];
      return true;
    }
    
    return false;
  }

  function captureUserAnswer(userMessage) {
    if (!discoveryProgress.waitingForAnswer || isCapturingAnswer) {
      return;
    }
    
    const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
    if (!currentQ || currentQ.answered) {
      return;
    }
    
    console.log(`📝 Buffering answer for Q${discoveryProgress.currentQuestionIndex + 1}: "${userMessage}"`);
    
    userResponseBuffer.push(userMessage.trim());
    
    if (answerCaptureTimer) {
      clearTimeout(answerCaptureTimer);
    }
    
    answerCaptureTimer = setTimeout(() => {
      if (isCapturingAnswer) return;
      
      isCapturingAnswer = true;
      
      const completeAnswer = userResponseBuffer.join(' ');
      
      currentQ.answered = true;
      currentQ.answer = completeAnswer;
      discoveryData[currentQ.field] = completeAnswer;
      discoveryData[`question_${discoveryProgress.currentQuestionIndex}`] = completeAnswer;
      
      discoveryProgress.questionsCompleted++;
      discoveryProgress.waitingForAnswer = false;
      discoveryProgress.allQuestionsCompleted = discoveryQuestions.every(q => q.answered);
      
      console.log(`✅ CAPTURED Q${discoveryProgress.currentQuestionIndex + 1}: "${completeAnswer}"`);
      console.log(`📊 Progress: ${discoveryProgress.questionsCompleted}/6 questions completed`);
      
      userResponseBuffer = [];
      isCapturingAnswer = false;
      answerCaptureTimer = null;
      
    }, 3000);
  }

  // Enhanced system prompt with Google Calendar integration
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella.

CONVERSATION FLOW:
1. GREETING PHASE: Start with a warm greeting and ask how they're doing
2. BRIEF CHAT: Engage in 1-2 exchanges of pleasantries before discovery
3. TRANSITION: Naturally transition to discovery questions
4. DISCOVERY PHASE: Ask all 6 discovery questions systematically
5. SCHEDULING PHASE: Only after all 6 questions are complete

GREETING & TRANSITION GUIDELINES:
- Always start with: "Hi there! This is Sarah from Nexella AI. How are you doing today?"
- When they respond to how they're doing, acknowledge it warmly
- After 1-2 friendly exchanges, transition naturally with something like:
  "That's great to hear! I'd love to learn a bit more about you and your business so I can better help you today."
- Then start with the first discovery question

CRITICAL DISCOVERY REQUIREMENTS:
- You MUST ask ALL 6 discovery questions in the exact order listed below
- Ask ONE question at a time and wait for the customer's response
- Do NOT move to scheduling until ALL 6 questions are answered
- After each answer, acknowledge it briefly before asking the next question

DISCOVERY QUESTIONS (ask in this EXACT order):
1. "How did you hear about us?"
2. "What industry or business are you in?"
3. "What's your main product or service?"
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

SPEAKING STYLE & PACING:
- Speak at a SLOW, measured pace - never rush your words
- Insert natural pauses between sentences using periods (.)
- Complete all your sentences fully - never cut off mid-thought
- Use shorter sentences rather than long, complex ones
- Keep your statements and questions concise but complete

PERSONALITY & TONE:
- Be warm and friendly but speak in a calm, measured way
- Use a consistent, even speaking tone throughout the conversation
- Use contractions and everyday language that sounds natural
- Maintain a calm, professional demeanor at all times
- If you ask a question with a question mark '?' go up in pitch and tone towards the end of the sentence.
- If you respond with "." always keep an even consistent tone towards the end of the sentence.

DISCOVERY FLOW:
- Only start discovery questions AFTER greeting exchange is complete
- After each answer, acknowledge it briefly with varied responses like:
  * "Perfect, thank you."
  * "Got it, that's helpful."
  * "Great, I understand."
  * "Excellent, thank you."
  * "That makes sense."
  * "Wonderful, thanks."
  * "I see, that's very helpful."
  * "Perfect, understood."
  * "Awesome, got it."
- CRITICAL: Never use the same acknowledgment twice in a row
- Keep acknowledgments short and natural
- Then immediately ask the next question
- Do NOT skip questions or assume answers
- Count your questions mentally: 1, 2, 3, 4, 5, 6

SCHEDULING APPROACH - REAL GOOGLE CALENDAR INTEGRATION:
- ONLY after asking ALL 6 discovery questions, present available times from the actual calendar
- When showing availability, be specific: "I have [day] at [time], [time], and [time]. Which works best?"
- ALWAYS check the real calendar before confirming any time
- When they request a specific time:
  * If available: "Perfect! Let me book that for you right now." Then actually create the calendar event
  * If NOT available: "I'm sorry, that time is already booked. I do have [alternative times] available. Which would work better?"
- After booking: "Great! I've scheduled our meeting for [confirmed time]. You'll receive a calendar invitation with all the details."
- Always provide specific alternative times when their preference isn't available
- Never say "let me check" - you have real-time access to the calendar

CALENDAR RESPONSES:
- Show only FUTURE available times (never past dates)
- Show only BUSINESS HOURS (Monday-Friday, 9 AM - 5 PM)
- Present 2-4 specific time options when possible
- Always confirm bookings immediately: "Done! You're all set for [confirmed time]."
- If no availability exists, suggest the earliest available times in the following weeks

IMPORTANT: Use real calendar data to provide accurate availability. Never make assumptions about open times.

Remember: Start with greeting, have brief pleasant conversation, then systematically complete ALL 6 discovery questions before showing real available calendar times.`
    }
  ];

  let conversationState = 'introduction';
  let bookingInfo = {
    name: connectionData.customerName || '',
    email: connectionData.customerEmail || '',
    phone: connectionData.customerPhone || '',
    preferredDay: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let discoveryData = {};
  let collectedContactInfo = !!connectionData.customerEmail;
  let userHasSpoken = false;
  let webhookSent = false;

  ws.send(JSON.stringify({
    content: "Hi there",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending auto-greeting message');
      ws.send(JSON.stringify({
        content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 4000);

  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending backup auto-greeting');
      ws.send(JSON.stringify({
        content: "Hello! This is Sarah from Nexella AI. I'm here to help you today. How's everything going?",
        content_complete: true,
        actions: [],
        response_id: 2
      }));
    }
  }, 8000);

  // ENHANCED Message Handler with Fixed Calendar Integration
  ws.on('message', async (data) => {
    try {
      clearTimeout(autoGreetingTimer);
      userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      console.log('📥 Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      if (parsed.call && parsed.call.call_id) {
        if (!connectionData.callId) {
          connectionData.callId = parsed.call.call_id;
          console.log(`🔗 Got call ID from WebSocket: ${connectionData.callId}`);
        }
        
        if (parsed.call.metadata) {
          if (!connectionData.customerEmail && parsed.call.metadata.customer_email) {
            connectionData.customerEmail = parsed.call.metadata.customer_email;
            bookingInfo.email = connectionData.customerEmail;
            console.log(`✅ Got email from WebSocket metadata: ${connectionData.customerEmail}`);
          }
          
          if (!connectionData.customerName && parsed.call.metadata.customer_name) {
            connectionData.customerName = parsed.call.metadata.customer_name;
            bookingInfo.name = connectionData.customerName;
            console.log(`✅ Got name from WebSocket metadata: ${connectionData.customerName}`);
          }
          
          if (!connectionData.customerPhone && (parsed.call.metadata.customer_phone || parsed.call.to_number)) {
            connectionData.customerPhone = parsed.call.metadata.customer_phone || parsed.call.to_number;
            bookingInfo.phone = connectionData.customerPhone;
            console.log(`✅ Got phone from WebSocket metadata: ${connectionData.customerPhone}`);
          }
        }
        
        if (!connectionData.customerPhone && parsed.call.to_number) {
          connectionData.customerPhone = parsed.call.to_number;
          bookingInfo.phone = connectionData.customerPhone;
          console.log(`✅ Got phone from call object: ${connectionData.customerPhone}`);
        }
        
        activeCallsMetadata.set(connectionData.callId, {
          customer_email: connectionData.customerEmail,
          customer_name: connectionData.customerName,
          phone: connectionData.customerPhone,
          to_number: connectionData.customerPhone
        });
        
        collectedContactInfo = !!connectionData.customerEmail;
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('🗣️ User said:', userMessage);
        console.log('🔄 Current conversation state:', conversationState);
        console.log('📊 Discovery progress:', discoveryProgress);

        if (conversationHistory.length >= 2) {
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            detectQuestionAsked(lastBotMessage.content);
          }
        }

        if (discoveryProgress.waitingForAnswer && userMessage.trim().length > 2) {
          captureUserAnswer(userMessage);
        }

        let schedulingDetected = false;
        let alternativeTimeNeeded = false;
        let calendarCheckResponse = '';
        
        // ENHANCED: Scheduling detection with Google Calendar integration
        if (discoveryProgress.allQuestionsCompleted && 
            userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today|\d{1,2}\s*(am|pm)|morning|afternoon|evening)\b/)) {
          
          console.log('🗓️ User mentioned scheduling after completing ALL discovery questions');
          console.log('🔍 User message:', userMessage);
          
          const dayInfo = handleSchedulingPreference(userMessage);
          console.log('📅 Parsed day info:', dayInfo);
          
          if (dayInfo && !webhookSent) {
            try {
              console.log('📅 Checking Google Calendar availability for:', dayInfo.date);
              
              // Enhanced calendar checking with specific time
              let preferredHour = 10; // Default 10 AM
              
              // Parse specific time from user input
              if (dayInfo.timePreference) {
                const timeStr = dayInfo.timePreference.toLowerCase();
                if (timeStr.includes('morning') || timeStr.includes('am')) {
                  preferredHour = timeStr.includes('early') ? 9 : 10;
                } else if (timeStr.includes('afternoon') || timeStr.includes('pm')) {
                  preferredHour = timeStr.includes('late') ? 15 : 14;
                } else if (timeStr.includes('evening')) {
                  preferredHour = 16;
                }
                
                // Extract specific hour if mentioned
                const hourMatch = timeStr.match(/(\d{1,2})/);
                if (hourMatch) {
                  const hour = parseInt(hourMatch[1]);
                  if (timeStr.includes('pm') && hour !== 12) {
                    preferredHour = hour + 12;
                  } else if (timeStr.includes('am') && hour === 12) {
                    preferredHour = 0;
                  } else if (timeStr.includes('am') || hour >= 8) {
                    preferredHour = hour;
                  }
                }
              }
              
              // Set the preferred time
              const preferredDateTime = new Date(dayInfo.date);
              preferredDateTime.setHours(preferredHour, 0, 0, 0);
              
              console.log('⏰ Preferred date/time:', preferredDateTime.toLocaleString());
              
              // Check if this specific time is available
              const endDateTime = new Date(preferredDateTime);
              endDateTime.setHours(preferredDateTime.getHours() + 1); // 1-hour meeting
              
              const isSpecificTimeAvailable = await checkAvailability(
                preferredDateTime.toISOString(), 
                endDateTime.toISOString()
              );
              
              console.log(`📊 Specific time availability: ${isSpecificTimeAvailable}`);
              
              if (isSpecificTimeAvailable) {
                // Time is available - book it
                console.log('✅ Time available - proceeding with booking');
                
                // Create the calendar event immediately
                const bookingResult = await calendarService.createEvent({
                  summary: 'Nexella AI Consultation Call',
                  description: `Discovery call with ${bookingInfo.name || connectionData.customerName || 'Customer'}\n\nDiscovery Notes:\n${Object.entries(discoveryData).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
                  startTime: preferredDateTime.toISOString(),
                  endTime: endDateTime.toISOString(),
                  attendeeEmail: bookingInfo.email || connectionData.customerEmail,
                  attendeeName: bookingInfo.name || connectionData.customerName || 'Customer'
                });
                
                if (bookingResult.success) {
                  bookingInfo.preferredDay = `${dayInfo.dayName} at ${preferredDateTime.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit', 
                    hour12: true 
                  })}`;
                  schedulingDetected = true;
                  
                  calendarCheckResponse = `Perfect! I've booked you for ${dayInfo.dayName} at ${preferredDateTime.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit', 
                    hour12: true 
                  })}. You'll receive a calendar invitation with the meeting details shortly.`;
                  
                  console.log('✅ Calendar event created and confirmed');
                } else {
                  calendarCheckResponse = `Great! Let me schedule you for ${dayInfo.dayName}. I'll send you the calendar invitation shortly.`;
                  schedulingDetected = true;
                }
              } else {
                // Time not available - suggest alternatives
                console.log('❌ Preferred time not available, finding alternatives...');
                
                const availableSlots = await getAvailableTimeSlots(dayInfo.date);
                console.log(`📋 Found ${availableSlots.length} alternative slots for ${dayInfo.dayName}`);
                
                if (availableSlots.length > 0) {
                  alternativeTimeNeeded = true;
                  const firstSlot = availableSlots[0];
                  const secondSlot = availableSlots[1];
                  
                  if (secondSlot) {
                    calendarCheckResponse = `I'm sorry, that time is already booked. I do have ${firstSlot.displayTime} or ${secondSlot.displayTime} available on ${dayInfo.dayName}. Which would work better for you?`;
                  } else {
                    calendarCheckResponse = `I'm sorry, that time is already booked. I do have ${firstSlot.displayTime} available on ${dayInfo.dayName}. Would that work for you?`;
                  }
                } else {
                  // No slots available that day - suggest next available slots
                  console.log('❌ No slots available on requested day, getting upcoming availability...');
                  
                  const upcomingSlots = await getFormattedAvailableSlots(dayInfo.date, 14); // Check next 2 weeks
                  
                  if (upcomingSlots.length > 0) {
                    const nextDay = upcomingSlots[0];
                    if (upcomingSlots.length === 1) {
                      calendarCheckResponse = `I don't have any availability on ${dayInfo.dayName}. My next available time is ${nextDay.dayName} at ${nextDay.formattedSlots}. Would any of those work?`;
                    } else {
                      const secondDay = upcomingSlots[1];
                      calendarCheckResponse = `I don't have any availability on ${dayInfo.dayName}. I do have times available on ${nextDay.dayName} at ${nextDay.formattedSlots}, or ${secondDay.dayName} at ${secondDay.formattedSlots}. What works better for you?`;
                    }
                    alternativeTimeNeeded = true;
                  } else {
                    calendarCheckResponse = "I don't have any availability that week. Let me check my calendar for the following weeks and get back to you.";
                    alternativeTimeNeeded = true;
                  }
                }
              }
            } catch (calendarError) {
              console.error('❌ Error checking calendar:', calendarError);
              // Fallback to basic scheduling
              bookingInfo.preferredDay = dayInfo.dayName;
              schedulingDetected = true;
              calendarCheckResponse = `Great! Let me schedule you for ${dayInfo.dayName}. I'll check my calendar and confirm the exact time.`;
            }
          }
        } else if (!discoveryProgress.allQuestionsCompleted && 
                   userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
          console.log('⚠️ User mentioned scheduling but discovery is not complete. Continuing with questions.');
        }

        conversationHistory.push({ role: 'user', content: userMessage });

        let contextPrompt = '';
        if (!discoveryProgress.allQuestionsCompleted) {
          const nextUnanswered = discoveryQuestions.find(q => !q.answered);
          if (nextUnanswered) {
            const questionNumber = discoveryQuestions.indexOf(nextUnanswered) + 1;
            const completed = discoveryQuestions.filter(q => q.answered).map((q, i) => `${discoveryQuestions.indexOf(q) + 1}. ${q.question} ✓`).join('\n');
            
            const lastAnsweredQ = discoveryQuestions.find(q => q.asked && q.answered && q.answer);
            let acknowledgmentInstruction = '';
            
            if (lastAnsweredQ && discoveryProgress.questionsCompleted > 0) {
              const lastQuestionIndex = discoveryQuestions.indexOf(lastAnsweredQ);
              const suggestedAck = getContextualAcknowledgment(lastAnsweredQ.answer, lastQuestionIndex);
              acknowledgmentInstruction = `

The user just answered: "${lastAnsweredQ.answer}"
Acknowledge this with: "${suggestedAck}" then ask the next question.`;
            }
            
            contextPrompt = `

DISCOVERY STATUS:
COMPLETED (${discoveryProgress.questionsCompleted}/6):
${completed || 'None yet'}

NEXT TO ASK:
${questionNumber}. ${nextUnanswered.question}${acknowledgmentInstruction}

CRITICAL: Ask question ${questionNumber} next. Do NOT repeat completed questions. Do NOT skip to scheduling until all 6 are done.`;
          }
        } else {
          // ENHANCED: Context prompts for calendar integration
          if (alternativeTimeNeeded) {
            contextPrompt = `

All 6 discovery questions completed. The user's preferred time is not available. 
RESPOND EXACTLY WITH: "${calendarCheckResponse}"
Do not add any other text or explanation. Just provide the alternative time options.`;
          } else if (schedulingDetected) {
            contextPrompt = `

All 6 discovery questions completed. Time slot confirmed as available and BOOKED. 
RESPOND EXACTLY WITH: "${calendarCheckResponse}"
Do not add any other text. Confirm the booking.`;
          } else {
            // Generate availability response
            const availabilityResponse = await generateAvailabilityResponse();
            contextPrompt = `

All 6 discovery questions completed. Show available times and ask for scheduling preference.
RESPOND EXACTLY WITH: "Perfect! I have all the information I need. Let's schedule a call to discuss how we can help. ${availabilityResponse}"`;
          }
        }

        const messages = [...conversationHistory];
        if (contextPrompt) {
          messages[messages.length - 1].content += contextPrompt;
        }

        const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-4o',
          messages: messages,
          temperature: 0.7
        }, {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        });

        const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me a bit more about that?";
        conversationHistory.push({ role: 'assistant', content: botReply });

        if (conversationState === 'introduction') {
          conversationState = 'discovery';
        } else if (conversationState === 'discovery' && discoveryProgress.allQuestionsCompleted) {
          conversationState = 'booking';
          console.log('🔄 Transitioning to booking state - ALL 6 discovery questions completed');
        }

        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
        // ENHANCED: Webhook sending with Google Calendar integration
        if (schedulingDetected && discoveryProgress.allQuestionsCompleted && !webhookSent) {
          console.log('🚀 SENDING WEBHOOK - All conditions met:');
          console.log('   ✅ All 6 discovery questions completed and answered');
          console.log('   ✅ Scheduling preference detected');
          console.log('   ✅ Contact info available');
          
          const finalDiscoveryData = {};
          discoveryQuestions.forEach((q, index) => {
            if (q.answered && q.answer) {
              finalDiscoveryData[q.field] = q.answer;
              finalDiscoveryData[`question_${index}`] = q.answer;
            }
          });
          
          console.log('📋 Final discovery data being sent:', JSON.stringify(finalDiscoveryData, null, 2));
          
          const result = await sendSchedulingPreference(
            bookingInfo.name || connectionData.customerName || '',
            bookingInfo.email || connectionData.customerEmail || '',
            bookingInfo.phone || connectionData.customerPhone || '',
            bookingInfo.preferredDay,
            connectionData.callId,
            finalDiscoveryData
          );
          
          if (result.success) {
            webhookSent = true;
            conversationState = 'completed';
            console.log('✅ Webhook sent successfully with all discovery data');
            
            // Log booking details if calendar event was created
            if (result.booking && result.booking.success) {
              console.log('📅 Calendar event created:', result.meetingDetails);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      
      // Emergency webhook send for substantial discovery data
      if (!webhookSent && connectionData.callId && 
          (bookingInfo.email || connectionData.customerEmail) &&
          discoveryProgress.questionsCompleted >= 4) {
        try {
          console.log('🚨 EMERGENCY WEBHOOK SEND - Substantial discovery data available');
          
          const emergencyDiscoveryData = {};
          discoveryQuestions.forEach((q, index) => {
            if (q.answered && q.answer) {
              emergencyDiscoveryData[q.field] = q.answer;
              emergencyDiscoveryData[`question_${index}`] = q.answer;
            }
          });
          
          await sendSchedulingPreference(
            bookingInfo.name || connectionData.customerName || '',
            bookingInfo.email || connectionData.customerEmail || '',
            bookingInfo.phone || connectionData.customerPhone || '',
            bookingInfo.preferredDay || 'Error occurred',
            connectionData.callId,
            emergencyDiscoveryData
          );
          webhookSent = true;
          console.log('✅ Emergency webhook sent with available discovery data');
        } catch (webhookError) {
          console.error('❌ Emergency webhook also failed:', webhookError.message);
        }
      }
      
      ws.send(JSON.stringify({
        content: "I missed that. Could you repeat it?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });

  // ENHANCED: Connection close handler with final webhook attempt
  ws.on('close', async () => {
    console.log('🔌 Connection closed.');
    clearTimeout(autoGreetingTimer);
    
    if (answerCaptureTimer) {
      clearTimeout(answerCaptureTimer);
      console.log('🧹 Cleared pending answer capture timer');
    }
    
    // Capture any buffered answers
    if (userResponseBuffer.length > 0 && discoveryProgress.waitingForAnswer) {
      const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
      if (currentQ && !currentQ.answered) {
        const completeAnswer = userResponseBuffer.join(' ');
        currentQ.answered = true;
        currentQ.answer = completeAnswer;
        discoveryData[currentQ.field] = completeAnswer;
        discoveryData[`question_${discoveryProgress.currentQuestionIndex}`] = completeAnswer;
        discoveryProgress.questionsCompleted++;
        console.log(`🔌 Captured buffered answer on close: "${completeAnswer}"`);
      }
    }
    
    console.log('=== FINAL CONNECTION CLOSE ANALYSIS ===');
    console.log('📋 Final discoveryData:', JSON.stringify(discoveryData, null, 2));
    console.log('📊 Questions completed:', discoveryProgress.questionsCompleted);
    console.log('📊 All questions completed:', discoveryProgress.allQuestionsCompleted);
    
    discoveryQuestions.forEach((q, index) => {
      console.log(`Question ${index + 1}: Asked=${q.asked}, Answered=${q.answered}, Answer="${q.answer}"`);
    });
    
    // Final webhook attempt if we have substantial data
    if (!webhookSent && connectionData.callId && discoveryProgress.questionsCompleted >= 2) {
      try {
        const finalEmail = connectionData.customerEmail || bookingInfo.email || '';
        const finalName = connectionData.customerName || bookingInfo.name || '';
        const finalPhone = connectionData.customerPhone || bookingInfo.phone || '';
        
        console.log('🚨 FINAL WEBHOOK ATTEMPT on connection close');
        console.log(`📊 Sending with ${discoveryProgress.questionsCompleted}/6 questions completed`);
        
        const finalDiscoveryData = {};
        discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
        await sendSchedulingPreference(
          finalName,
          finalEmail,
          finalPhone,
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          finalDiscoveryData
        );
        
        console.log('✅ Final webhook sent successfully on connection close');
        webhookSent = true;
      } catch (finalError) {
        console.error('❌ Final webhook failed:', finalError.message);
      }
    }
    
    if (connectionData.callId) {
      activeCallsMetadata.delete(connectionData.callId);
      console.log(`🧹 Cleaned up metadata for call ${connectionData.callId}`);
    }
  });
});

wss.on('error', (error) => {
  console.error('❌ WebSocket Server Error:', error);
});

server.on('error', (error) => {
  console.error('❌ HTTP Server Error:', error);
});

// ENHANCED: Retell webhook handler with Google Calendar integration
app.post('/retell-webhook', express.json(), async (req, res) => {
  try {
    const { event, call } = req.body;
    
    console.log(`Received Retell webhook event: ${event}`);
    
    if (call && call.call_id) {
      console.log(`Call ID: ${call.call_id}, Status: ${call.call_status}`);
      
      const email = call.metadata?.customer_email || '';
      const name = call.metadata?.customer_name || '';
      const phone = call.to_number || '';
      let preferredDay = '';
      let discoveryData = {};
      
      if (email) {
        storeContactInfoGlobally(name, email, phone, 'Retell Webhook');
      }
      
      // Extract scheduling and discovery data
      if (call.variables && call.variables.preferredDay) {
        preferredDay = call.variables.preferredDay;
      } else if (call.custom_data && call.custom_data.preferredDay) {
        preferredDay = call.custom_data.preferredDay;
      } else if (call.analysis && call.analysis.custom_data) {
        try {
          const customData = typeof call.analysis.custom_data === 'string'
            ? JSON.parse(call.analysis.custom_data)
            : call.analysis.custom_data;
            
          if (customData.preferredDay) {
            preferredDay = customData.preferredDay;
          }
        } catch (error) {
          console.error('Error parsing custom data:', error);
        }
      }
      
      if (call.variables) {
        Object.entries(call.variables).forEach(([key, value]) => {
          if (key.startsWith('discovery_') || key.includes('question_')) {
            discoveryData[key] = value;
          }
        });
      }
      
      if (call.custom_data && call.custom_data.discovery_data) {
        try {
          const parsedData = typeof call.custom_data.discovery_data === 'string' 
            ? JSON.parse(call.custom_data.discovery_data)
            : call.custom_data.discovery_data;
            
          discoveryData = { ...discoveryData, ...parsedData };
        } catch (error) {
          console.error('Error parsing discovery data from custom_data:', error);
        }
      }
      
      // Extract from transcript if no other discovery data found
      if (Object.keys(discoveryData).length === 0 && call.transcript && call.transcript.length > 0) {
        const discoveryQuestions = [
          'How did you hear about us?',
          'What industry or business are you in?',
          'What\'s your main product?',
          'Are you running ads right now?',
          'Are you using a CRM system?',
          'What pain points are you experiencing?'
        ];
        
        call.transcript.forEach((item, index) => {
          if (item.role === 'assistant') {
            const botMessage = item.content.toLowerCase();
            
            discoveryQuestions.forEach((question, qIndex) => {
              if (botMessage.includes(question.toLowerCase().substring(0, 15))) {
                if (call.transcript[index + 1] && call.transcript[index + 1].role === 'user') {
                  const answer = call.transcript[index + 1].content;
                  discoveryData[`question_${qIndex}`] = answer;
                }
              }
            });
          }
        });
      }
      
      if ((event === 'call_ended' || event === 'call_analyzed') && email) {
        console.log(`Sending webhook for ${event} event with discovery data:`, discoveryData);
        
        try {
          await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, {
            name,
            email,
            phone,
            preferredDay: preferredDay || 'Not specified',
            call_id: call.call_id,
            call_status: call.call_status,
            discovery_data: discoveryData,
            schedulingComplete: true,
            calendar_platform: 'google',
            calendar_booking: false
          });
          
          console.log(`Successfully sent webhook for ${event}`);
        } catch (error) {
          console.error(`Error sending webhook for ${event}:`, error);
        }
      }
      
      activeCallsMetadata.delete(call.call_id);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error handling Retell webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server with Google Calendar integration is listening on port ${PORT}`);
});
