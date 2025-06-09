// src/services/calendar/GoogleCalendarService.js - COMPLETELY FIXED FOR ARIZONA MST TIME DISPLAY
const { google } = require('googleapis');
const config = require('../../config/environment');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.calendarId = config.GOOGLE_CALENDAR_ID || 'primary';
    
    // FIXED: Arizona timezone - MST year-round (no DST)
    this.timezone = 'America/Phoenix'; // Arizona MST - no daylight saving
    
    // FIXED: Your ACTUAL business hours in Arizona MST
    this.businessHours = {
      start: 8,   // 8 AM Arizona time
      end: 16,    // 4 PM Arizona time (16:00 in 24-hour format)
      days: [1, 2, 3, 4, 5], // Monday to Friday only
      slotDuration: 60, // 1 hour appointments
      // FIXED: Proper business hours array for Arizona
      availableHours: [8, 9, 10, 11, 13, 14, 15] // 8AM-11AM, 1PM-3PM (skip 12PM for lunch)
    };
    
    console.log('🔧 GoogleCalendarService initialized for Arizona MST');
    console.log('📅 Calendar ID:', this.calendarId);
    console.log('🌍 Timezone: America/Phoenix (MST year-round)');
    console.log('🕐 Business Hours:', this.businessHours.availableHours.map(h => `${h}:00`).join(', '));
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Calendar service...');
      
      // Validate required environment variables
      if (!config.GOOGLE_PROJECT_ID || !config.GOOGLE_PRIVATE_KEY || !config.GOOGLE_CLIENT_EMAIL) {
        throw new Error('Missing required Google Calendar environment variables. Check GOOGLE_PROJECT_ID, GOOGLE_PRIVATE_KEY, and GOOGLE_CLIENT_EMAIL');
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Calendar service initialized successfully');
        
        // Test the connection
        const testResult = await this.testConnection();
        if (!testResult) {
          throw new Error('Calendar connection test failed');
        }
        return true;
      } else {
        throw new Error('Google Calendar authentication failed');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Calendar service:', error.message);
      throw error; // Don't fallback - fail if calendar can't initialize
    }
  }

  async setupAuthentication() {
    try {
      console.log('🔐 Setting up Google Calendar authentication...');
      
      const privateKey = config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
      console.log('🔑 Private key format check:', privateKey.includes('-----BEGIN PRIVATE KEY-----') ? '✅ Valid' : '❌ Invalid');
      
      const serviceAccountKey = {
        type: "service_account",
        project_id: config.GOOGLE_PROJECT_ID,
        private_key_id: config.GOOGLE_PRIVATE_KEY_ID || "dummy_key_id",
        private_key: privateKey,
        client_email: config.GOOGLE_CLIENT_EMAIL,
        client_id: config.GOOGLE_CLIENT_ID || "dummy_client_id",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/oauth2/v1/certs/${encodeURIComponent(config.GOOGLE_CLIENT_EMAIL)}`
      };
      
      console.log('📧 Service account email:', serviceAccountKey.client_email);
      console.log('🏗️ Project ID:', serviceAccountKey.project_id);
      
      this.auth = new google.auth.GoogleAuth({
        credentials: serviceAccountKey,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events'
        ]
      });
      
      console.log('✅ Authentication configured successfully');
      
    } catch (error) {
      console.error('❌ Authentication setup failed:', error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Calendar connection...');
      
      const response = await this.calendar.calendars.get({
        calendarId: this.calendarId
      });
      
      console.log(`✅ Connected to calendar: ${response.data.summary}`);
      console.log(`📅 Calendar ID: ${this.calendarId}`);
      console.log(`🌍 Calendar Timezone: ${response.data.timeZone || 'Not set'}`);
      console.log(`🔄 Using Arizona timezone: ${this.timezone} (MST year-round)`);
      
      return true;
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      if (error.message.includes('Not Found')) {
        console.error('🔍 Calendar not found. Check GOOGLE_CALENDAR_ID and calendar sharing settings.');
      }
      throw error;
    }
  }

  async getAvailableSlots(date) {
    try {
      console.log(`📅 Getting available slots for: ${date} (Arizona MST)`);
      
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();
      
      // Check if it's a business day
      if (!this.businessHours.days.includes(dayOfWeek)) {
        console.log('📅 Not a business day (weekends excluded), no slots available');
        return [];
      }

      // Check if it's in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate < today) {
        console.log('📅 Date is in the past, no slots available');
        return [];
      }

      // COMPLETELY FIXED: Create slots in proper Arizona timezone
      const availableSlots = [];
      
      for (const hour of this.businessHours.availableHours) {
        // FIXED: Create Arizona time properly by accounting for UTC offset
        // Arizona is UTC-7 (MST), so 8 AM Arizona = 15:00 UTC (8 + 7)
        const arizonaOffsetHours = 7; // Arizona is UTC-7
        const utcHour = hour + arizonaOffsetHours;
        
        // Create slot start time in UTC that represents the Arizona time
        const slotStart = new Date(targetDate);
        slotStart.setUTCHours(utcHour, 0, 0, 0);
        
        const slotEnd = new Date(targetDate);
        slotEnd.setUTCHours(utcHour + 1, 0, 0, 0);
        
        // FIXED: If it's today, only show slots at least 1 hour from now
        if (targetDate.toDateString() === today.toDateString()) {
          const now = new Date();
          const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
          
          if (slotStart <= oneHourFromNow) {
            console.log(`⏰ Skipping slot at ${hour}:00 Arizona time - too soon or past`);
            continue;
          }
        }
        
        try {
          // Check for conflicts using proper UTC times
          const response = await this.calendar.events.list({
            calendarId: this.calendarId,
            timeMin: slotStart.toISOString(),
            timeMax: slotEnd.toISOString(),
            singleEvents: true,
            orderBy: 'startTime'
          });

          const events = response.data.items || [];
          
          // Check if this slot conflicts with any existing event
          const hasConflict = events.some(event => {
            const eventStart = new Date(event.start.dateTime || event.start.date);
            const eventEnd = new Date(event.end.dateTime || event.end.date);
            return (slotStart < eventEnd && slotEnd > eventStart);
          });

          if (!hasConflict) {
            // FIXED: Display the ARIZONA time, not the UTC time
            const arizonaDisplayTime = this.formatArizonaTime(hour);
            
            availableSlots.push({
              startTime: slotStart.toISOString(),
              endTime: slotEnd.toISOString(),
              displayTime: arizonaDisplayTime,
              arizonaHour: hour // Store the actual Arizona hour
            });
            
            console.log(`✅ Available slot: ${arizonaDisplayTime} Arizona MST (UTC: ${slotStart.toISOString()})`);
          } else {
            console.log(`❌ Slot conflict at ${hour}:00 Arizona time`);
          }
        } catch (eventError) {
          console.error(`❌ Error checking events for ${hour}:00 Arizona time:`, eventError.message);
          // Skip this slot if we can't check for conflicts
          continue;
        }
      }

      console.log(`✅ Generated ${availableSlots.length} available slots for Arizona MST`);
      return availableSlots;

    } catch (error) {
      console.error('❌ Error getting calendar slots:', error.message);
      throw error; // Don't return fallback data - fail if calendar fails
    }
  }

  // FIXED: Format Arizona time properly
  formatArizonaTime(arizonaHour) {
    const displayHour = arizonaHour > 12 ? arizonaHour - 12 : arizonaHour === 0 ? 12 : arizonaHour;
    const period = arizonaHour >= 12 ? 'PM' : 'AM';
    return `${displayHour}:00 ${period}`;
  }

  // FIXED: Format time for display (always show Arizona time)
  formatDisplayTime(utcDate, arizonaHour = null) {
    if (arizonaHour !== null) {
      return this.formatArizonaTime(arizonaHour);
    }
    
    // If we don't have the Arizona hour, calculate it from UTC
    const utcHour = utcDate.getUTCHours();
    const arizonaCalculatedHour = utcHour - 7; // Arizona is UTC-7
    const adjustedHour = arizonaCalculatedHour < 0 ? arizonaCalculatedHour + 24 : arizonaCalculatedHour;
    
    return this.formatArizonaTime(adjustedHour);
  }

  async isSlotAvailable(startTime, endTime) {
    try {
      console.log(`🔍 Checking slot availability: ${startTime} to ${endTime}`);
      
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startTime,
        timeMax: endTime,
        singleEvents: true
      });

      const events = response.data.items || [];
      const isAvailable = events.length === 0;
      
      console.log(`📊 Slot availability: ${isAvailable ? 'Available ✅' : 'Booked ❌'}`);
      return isAvailable;

    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      throw error; // Don't assume available if we can't check
    }
  }

  // Create a calendar event (booking) with proper Arizona timezone handling
  async createEvent(eventDetails) {
    try {
      console.log('📅 Creating calendar event:', eventDetails.summary);
      console.log('🕐 Event time:', eventDetails.startTime, 'to', eventDetails.endTime);

      // First, check if the slot is still available
      const isAvailable = await this.isSlotAvailable(eventDetails.startTime, eventDetails.endTime);
      if (!isAvailable) {
        console.log('❌ Slot no longer available');
        return {
          success: false,
          error: 'Slot no longer available',
          message: 'That time slot has been booked by someone else'
        };
      }

      // Create event with proper Arizona timezone
      const event = {
        summary: eventDetails.summary || 'Nexella AI Consultation Call',
        description: `${eventDetails.description || 'Discovery call scheduled via Nexella AI'}\n\nCustomer: ${eventDetails.attendeeName || eventDetails.attendeeEmail}\nEmail: ${eventDetails.attendeeEmail}`,
        start: {
          dateTime: eventDetails.startTime,
          timeZone: this.timezone // America/Phoenix for Arizona MST
        },
        end: {
          dateTime: eventDetails.endTime,
          timeZone: this.timezone // America/Phoenix for Arizona MST
        },
        attendees: [
          {
            email: eventDetails.attendeeEmail,
            displayName: eventDetails.attendeeName || eventDetails.attendeeEmail,
            responseStatus: 'needsAction'
          }
        ],
        conferenceData: {
          createRequest: {
            requestId: `meet_${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 24 hours before
            { method: 'email', minutes: 60 },      // 1 hour before
            { method: 'popup', minutes: 30 }       // 30 minutes before
          ]
        },
        guestsCanModify: false,
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false
      };

      console.log('📅 Creating calendar event with Arizona timezone...');

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Send invitations to attendees
      });

      const createdEvent = response.data;
      console.log('✅ Event created successfully:', createdEvent.id);
      console.log('🕐 Event start time:', createdEvent.start.dateTime);
      console.log('🌍 Event timezone:', createdEvent.start.timeZone);

      // Extract meeting link
      const meetingLink = createdEvent.conferenceData?.entryPoints?.[0]?.uri || 
                         createdEvent.hangoutLink || 
                         '';

      console.log('🔗 Meeting link generated:', meetingLink);

      // FIXED: Get the Arizona display time for confirmation
      const startDate = new Date(eventDetails.startTime);
      const arizonaDisplayTime = this.formatDisplayTime(startDate);

      return {
        success: true,
        eventId: createdEvent.id,
        meetingLink: meetingLink,
        eventLink: createdEvent.htmlLink,
        message: 'Appointment created successfully',
        customerEmail: eventDetails.attendeeEmail,
        customerName: eventDetails.attendeeName,
        startTime: eventDetails.startTime,
        endTime: eventDetails.endTime,
        timezone: this.timezone,
        displayTime: arizonaDisplayTime
      };

    } catch (error) {
      console.error('❌ Error creating calendar event:', error.message);
      
      // Provide more specific error messages
      if (error.message.includes('forbidden')) {
        return {
          success: false,
          error: 'Permission denied',
          message: 'Calendar permissions insufficient for booking'
        };
      } else if (error.message.includes('not found')) {
        return {
          success: false,
          error: 'Calendar not found',
          message: 'Calendar not found or not accessible'
        };
      } else {
        throw error; // Re-throw unexpected errors
      }
    }
  }

  // Parse user's time preference into a proper Arizona datetime
  parseTimePreference(userMessage, preferredDay) {
    console.log('🔍 Parsing time preference for Arizona MST:', { userMessage, preferredDay });
    
    let targetDate = new Date();
    
    // Parse the day
    if (preferredDay.toLowerCase().includes('tomorrow')) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (preferredDay.toLowerCase().includes('today')) {
      // Keep today
    } else if (preferredDay.toLowerCase().includes('next week')) {
      targetDate.setDate(targetDate.getDate() + 7);
    } else {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayMatch = preferredDay.toLowerCase().match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
      
      if (dayMatch) {
        const requestedDayName = dayMatch[0];
        const requestedDayIndex = daysOfWeek.indexOf(requestedDayName);
        const currentDayIndex = targetDate.getDay();
        
        let daysToAdd = requestedDayIndex - currentDayIndex;
        if (daysToAdd <= 0) {
          daysToAdd += 7; // Next week
        }
        
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    // Parse time and default to business hours
    let preferredHour = 9; // Default 9 AM Arizona time
    
    // Look for specific time patterns
    const timeMatch = preferredDay.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2] || '0');
      const period = timeMatch[3].toLowerCase();
      
      console.log('🕐 Parsed time components:', { hour, minutes, period });
      
      if (period === 'pm' && hour !== 12) {
        hour += 12;
      } else if (period === 'am' && hour === 12) {
        hour = 0;
      }
      
      // Ensure hour is within business hours (8 AM - 4 PM)
      if (this.businessHours.availableHours.includes(hour)) {
        preferredHour = hour;
        console.log('✅ Time is within business hours:', preferredHour);
      } else {
        console.log('⚠️ Requested time outside business hours, using default 9 AM Arizona time');
        preferredHour = 9;
      }
    } else if (preferredDay.toLowerCase().includes('morning')) {
      preferredHour = 9; // 9 AM Arizona time
    } else if (preferredDay.toLowerCase().includes('afternoon')) {
      preferredHour = 14; // 2 PM Arizona time
    } else if (preferredDay.toLowerCase().includes('evening')) {
      preferredHour = 15; // 3 PM, latest business hour
    }
    
    // FIXED: Set time properly accounting for Arizona timezone
    const arizonaOffsetHours = 7; // Arizona is UTC-7
    const utcHour = preferredHour + arizonaOffsetHours;
    targetDate.setUTCHours(utcHour, 0, 0, 0);
    
    console.log('🎯 Final parsed datetime (Arizona MST):', this.formatArizonaTime(preferredHour));
    console.log('🌐 UTC representation:', targetDate.toISOString());
    
    return {
      preferredDateTime: targetDate,
      dayName: preferredDay,
      hour: preferredHour,
      timezone: this.timezone
    };
  }

  isInitialized() {
    return !!(this.calendar && this.auth);
  }

  getCalendarInfo() {
    return {
      calendarId: this.calendarId,
      timezone: this.timezone,
      businessHours: this.businessHours,
      initialized: this.isInitialized(),
      hasAuth: !!this.auth,
      hasCalendar: !!this.calendar,
      location: 'Arizona MST (no daylight saving)',
      workingHours: '8:00 AM - 4:00 PM MST',
      availableSlots: this.businessHours.availableHours.map(h => this.formatArizonaTime(h)).join(', ')
    };
  }
}

module.exports = GoogleCalendarService;
