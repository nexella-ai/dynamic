// src/services/webhooks/WebhookService.js - FIXED WITH REAL METADATA EXTRACTION FROM WORKING CODE
const axios = require('axios');
const config = require('../../config/environment');
const { getCalendarService, isCalendarInitialized } = require('../calendar/CalendarHelpers');

// Store the latest Typeform submission for reference (FROM WORKING CODE)
global.lastTypeformSubmission = null;

// Store active calls metadata (FROM WORKING CODE)
const activeCallsMetadata = new Map();

// Store contact info globally (EXACT COPY FROM WORKING CODE)
function storeContactInfoGlobally(name, email, phone, source = 'Unknown') {
  console.log(`📝 Storing contact info globally from ${source}:`, { name, email, phone });
  
  // Always update if we have an email
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

// Update conversation state in trigger server
async function updateConversationState(callId, discoveryComplete, preferredDay) {
  try {
    const response = await axios.post(`${config.TRIGGER_SERVER_URL}/update-conversation`, {
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

// ENHANCED: Send scheduling data with proper email handling - EXACT COPY FROM WORKING CODE
async function sendSchedulingPreference(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    console.log('=== ENHANCED WEBHOOK SENDING DEBUG ===');
    console.log('Input parameters:', { name, email, phone, preferredDay, callId });
    console.log('Raw discovery data input:', JSON.stringify(discoveryData, null, 2));
    console.log('Discovery data keys:', Object.keys(discoveryData));
    console.log('Global Typeform submission:', global.lastTypeformSubmission);
    
    // ENHANCED: Try multiple methods to get email (FROM WORKING CODE)
    let finalEmail = email;
    let finalName = name;
    let finalPhone = phone;
    
    // Method 1: Use provided email if valid
    if (finalEmail && finalEmail.trim() !== '') {
      console.log(`Using provided email: ${finalEmail}`);
    }
    // Method 2: Get from global Typeform submission
    else if (global.lastTypeformSubmission && global.lastTypeformSubmission.email) {
      finalEmail = global.lastTypeformSubmission.email;
      console.log(`Using email from global Typeform: ${finalEmail}`);
    }
    // Method 3: Get from call metadata if available
    else if (callId && activeCallsMetadata.has(callId)) {
      const callMetadata = activeCallsMetadata.get(callId);
      if (callMetadata && callMetadata.customer_email) {
        finalEmail = callMetadata.customer_email;
        console.log(`Using email from call metadata: ${finalEmail}`);
      }
    }
    
    // Enhanced name and phone retrieval (FROM WORKING CODE)
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
    
    // CRITICAL: Don't proceed if we still don't have an email
    if (!finalEmail || finalEmail.trim() === '') {
      console.error('❌ CRITICAL: No email found from any source. Cannot send webhook.');
      return { success: false, error: 'No email address available' };
    }
    
    // ENHANCED: Process discovery data with better field mapping (FROM WORKING CODE)
    console.log('🔧 PROCESSING DISCOVERY DATA:');
    console.log('Raw discoveryData input:', JSON.stringify(discoveryData, null, 2));
    
    // Initialize formatted discovery data
    const formattedDiscoveryData = {};
    
    // Define field mappings from question keys to Airtable field names
    const fieldMappings = {
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry', 
      'question_2': 'Main product',
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
    };
    
    // Process all discovery data (FROM WORKING CODE)
    Object.entries(discoveryData).forEach(([key, value]) => {
      console.log(`🔧 Processing key: "${key}" with value: "${value}"`);
      
      if (value && typeof value === 'string' && value.trim() !== '') {
        const trimmedValue = value.trim();
        
        if (key.startsWith('question_') && fieldMappings[key]) {
          // Map question_X to the exact Airtable field name
          formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
          console.log(`✅ Mapped ${key} -> "${fieldMappings[key]}" = "${trimmedValue}"`);
        } else if (key === 'How did you hear about us' || key.includes('hear about')) {
          formattedDiscoveryData['How did you hear about us'] = trimmedValue;
          console.log(`✅ Direct mapping: How did you hear about us = "${trimmedValue}"`);
        } else if (key === 'Business/Industry' || key.includes('business') || key.includes('industry')) {
          // Only map if we don't already have it from question_1
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
          // Keep original key if it doesn't match any pattern
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

    // Google Calendar booking logic (REAL CALENDAR ONLY)
    let bookingResult = null;
    let meetingDetails = null;

    if (preferredDay && preferredDay !== 'Call ended early' && preferredDay !== 'Error occurred') {
      try {
        console.log('📅 Attempting Google Calendar booking...');
        
        const calendarService = getCalendarService();
        if (!calendarService || !isCalendarInitialized()) {
          throw new Error('Calendar service not available');
        } else {
          const timePreference = calendarService.parseTimePreference('', preferredDay);
          const { getAvailableTimeSlots } = require('../calendar/CalendarHelpers');
          const availableSlots = await getAvailableTimeSlots(timePreference.preferredDateTime);
          
          if (availableSlots.length > 0) {
            const selectedSlot = availableSlots[0];
            
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
              console.log('✅ Google Calendar booking successful');
            }
          } else {
            console.log('❌ No available slots found for preferred time');
          }
        }
      } catch (calendarError) {
        console.error('❌ Calendar booking error:', calendarError.message);
      }
    }
    
    // Create the webhook payload (FROM WORKING CODE)
    const webhookData = {
      name: finalName || '',
      email: finalEmail, // This is now guaranteed to have a value
      phone: finalPhone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData,
      formatted_discovery: formattedDiscoveryData, // Send both for compatibility
      // Google Calendar specific fields
      calendar_booking: bookingResult?.success || false,
      meeting_link: meetingDetails?.meetingLink || '',
      event_link: meetingDetails?.eventLink || '',
      event_id: meetingDetails?.eventId || '',
      scheduled_time: meetingDetails?.startTime || '',
      calendar_status: isCalendarInitialized() ? 'real_calendar' : 'calendar_unavailable',
      // Also include individual fields for direct access
      "How did you hear about us": formattedDiscoveryData["How did you hear about us"] || '',
      "Business/Industry": formattedDiscoveryData["Business/Industry"] || '',
      "Main product": formattedDiscoveryData["Main product"] || '',
      "Running ads": formattedDiscoveryData["Running ads"] || '',
      "Using CRM": formattedDiscoveryData["Using CRM"] || '',
      "Pain points": formattedDiscoveryData["Pain points"] || ''
    };
    
    console.log('📤 COMPLETE WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    console.log('✅ Sending scheduling preference to trigger server');
    
    const response = await axios.post(`${config.TRIGGER_SERVER_URL}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Scheduling preference sent successfully:', response.data);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error('❌ Error sending scheduling preference:', error);
    
    // Enhanced fallback to n8n with same data processing (FROM WORKING CODE)
    try {
      console.log('🔄 Attempting to send directly to n8n webhook as fallback');
      const n8nWebhookUrl = config.N8N_WEBHOOK_URL;
      
      // Use the same processing logic for fallback
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

// Handle Typeform webhook
function handleTypeformWebhook(typeformData) {
  console.log('📋 Handling Typeform webhook:', typeformData);
  
  // Extract relevant fields from Typeform data
  const email = typeformData.email || typeformData.form_response?.answers?.find(a => a.type === 'email')?.email;
  const name = typeformData.name || typeformData.form_response?.answers?.find(a => a.field?.ref === 'name')?.text;
  const phone = typeformData.phone || typeformData.form_response?.answers?.find(a => a.type === 'phone_number')?.phone_number;
  
  if (email) {
    storeContactInfoGlobally(name, email, phone, 'Typeform Webhook');
    return true;
  }
  
  console.warn('⚠️ No email found in Typeform data');
  return false;
}

module.exports = {
  storeContactInfoGlobally,
  updateConversationState,
  sendSchedulingPreference,
  activeCallsMetadata,
  handleTypeformWebhook
};
