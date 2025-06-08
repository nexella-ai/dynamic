// src/services/calendar/GoogleCalendarService.js - FIXED (8AM-4PM, NO DEMO MODE)
const { google } = require('googleapis');
const config = require('../../config/environment');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.calendarId = config.GOOGLE_CALENDAR_ID || 'primary';
    this.timezone = config.TIMEZONE || 'America/Phoenix';
    
    // YOUR ACTUAL BUSINESS HOURS: 8AM-4PM Arizona Time
    this.businessHours = {
      start: 8,   // 8 AM Arizona time
      end: 16,    // 4 PM Arizona time
      days: [1, 2, 3, 4, 5], // Monday to Friday only
      slotDuration: 60, // 1 hour slots
      // Available appointment hours (avoiding lunch 12-1)
      availableHours: [8, 9, 10, 11, 13, 14, 15] // 8AM-11AM, 1PM-3PM
    };
    
    console.log('🔧 GoogleCalendarService initialized');
    console.log('📅 Calendar ID:', this.calendarId);
    console.log('🌍 Timezone:', this.timezone);
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
      throw error; // Don't continue without calendar
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
      console.log(`🌍 Calendar Timezone: ${response.data.timeZone || this.timezone}`);
      
      // Use calendar's timezone if available
      if (response.data.timeZone) {
        this.timezone = response.data.timeZone;
        console.log(`🔄 Updated timezone to: ${this.timezone}`);
      }
      
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
      console.log(`📅 Getting available slots for: ${date}`);
      
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();
      
      // Check if it's a business day
      if (!this.businessHours.days.includes(dayOfWeek)) {
        console.log('📅 Not a business day, no slots available');
        return [];
      }

      // Check if it's in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate < today) {
        console.log('📅 Date is in the past, no slots available');
        return [];
      }

      // Set up time range properly in Arizona timezone
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(this.businessHours.start, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(this.businessHours.end, 0, 0, 0);

      // If it's today, start from current time + 1 hour
      if (targetDate.toDateString() === today.toDateString()) {
        const now = new Date();
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
        if (oneHourFromNow > startOfDay) {
          startOfDay.setTime(oneHourFromNow.getTime());
          // Round up to next hour
          startOfDay.setMinutes(0, 0, 0);
          startOfDay.setHours(startOfDay.getHours() + 1);
        }
      }

      console.log(`🕐 Checking from ${startOfDay.toLocaleString('en-US', {timeZone: this.timezone})} to ${endOfDay.toLocaleString('en-US', {timeZone: this.timezone})}`);

      // Get existing events for the day
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];
      console.log(`📋 Found ${events.length} existing events`);

      // Generate slots using your specific business hours
      const availableSlots = [];
      
      for (const hour of this.businessHours.availableHours) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, 0, 0, 0);
        
        const slotEnd = new Date(targetDate);
        slotEnd.setHours(hour + 1, 0, 0, 0);
        
        // If it's today, only show future times
        if (targetDate.toDateString() === today.toDateString()) {
          const now = new Date();
          const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
          if (slotStart <= oneHourFromNow) {
            console.log(`⏰ Skipping slot at ${hour}:00 - too soon`);
            continue;
          }
        }
        
        // Check if this slot conflicts with any existing event
        const hasConflict = events.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          return (slotStart < eventEnd && slotEnd > eventStart);
        });

        if (!hasConflict) {
          availableSlots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: this.formatDisplayTime(slotStart)
          });
          
          console.log(`✅ Available slot: ${this.formatDisplayTime(slotStart)} (${slotStart.toISOString()})`);
        } else {
          console.log(`❌ Slot conflict at ${this.formatDisplayTime(slotStart)}`);
        }
      }

      console.log(`✅ Generated ${availableSlots.length} available slots`);
      return availableSlots;

    } catch (error) {
      console.error('❌ Error getting calendar slots:', error.message);
      throw error; // Don't return fallback data
    }
  }

  // Format time for display (Arizona timezone)
  formatDisplayTime(date) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: this.timezone
    });
  }

  async isSlotAvailable(startTime, endTime) {
    try {
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
      throw error;
    }
  }

  // Create a calendar event (booking)
  async createEvent(eventDetails) {
    try {
      console.log('📅 Creating calendar event:', eventDetails.summary);

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

      const event = {
        summary: eventDetails.summary || 'Nexella AI Consultation Call',
        description: `${eventDetails.description || 'Discovery call scheduled via Nexella AI'}\n\nCustomer: ${eventDetails.attendeeName || eventDetails.attendeeEmail}\nEmail: ${eventDetails.attendeeEmail}`,
        start: {
          dateTime: eventDetails.startTime,
          timeZone: this.timezone
        },
        end: {
          dateTime: eventDetails.endTime,
          timeZone: this.timezone
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

      console.log('📅 Creating calendar event...');

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Send invitations to attendees
      });

      const createdEvent = response.data;
      console.log('✅ Event created successfully:', createdEvent.id);

      // Extract meeting link
      const meetingLink = createdEvent.conferenceData?.entryPoints?.[0]?.uri || 
                         createdEvent.hangoutLink || 
                         '';

      console.log('🔗 Meeting link generated:', meetingLink);

      return {
        success: true,
        eventId: createdEvent.id,
        meetingLink: meetingLink,
        eventLink: createdEvent.htmlLink,
        message: 'Appointment created successfully',
        customerEmail: eventDetails.attendeeEmail,
        customerName: eventDetails.attendeeName,
        startTime: eventDetails.startTime,
        endTime: eventDetails.endTime
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
        throw error;
      }
    }
  }

  // Parse user's time preference into a datetime
  parseTimePreference(userMessage, preferredDay) {
    console.log('🔍 Parsing time preference:', { userMessage, preferredDay });
    
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
    
    // Parse time - default to business hours
    let preferredHour = 10; // Default 10 AM
    
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
      
      // Ensure hour is within business hours
      if (this.businessHours.availableHours.includes(hour)) {
        preferredHour = hour;
        console.log('✅ Time is within business hours:', preferredHour);
      } else {
        console.log('⚠️ Requested time outside business hours, using default:', preferredHour);
      }
    } else if (preferredDay.toLowerCase().includes('morning')) {
      preferredHour = 9;
    } else if (preferredDay.toLowerCase().includes('afternoon')) {
      preferredHour = 14;
    } else if (preferredDay.toLowerCase().includes('evening')) {
      preferredHour = 15; // 3 PM, latest business hour
    }
    
    targetDate.setHours(preferredHour, 0, 0, 0);
    
    console.log('🎯 Final parsed datetime:', targetDate.toLocaleString('en-US', {timeZone: this.timezone}));
    
    return {
      preferredDateTime: targetDate,
      dayName: preferredDay,
      hour: preferredHour
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
      hasCalendar: !!this.calendar
    };
  }
}

module.exports = GoogleCalendarService;
