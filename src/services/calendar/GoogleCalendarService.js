// src/services/calendar/GoogleCalendarService.js - FIXED FOR MST/ARIZONA TIME ONLY
const { google } = require('googleapis');
const config = require('../../config/environment');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.calendarId = config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com';
    
    // Arizona timezone - MST year-round (no DST)
    this.timezone = 'America/Phoenix';
    
    // Business hours in Arizona
    this.businessHours = {
      start: 8,   // 8 AM MST
      end: 16,    // 4 PM MST
      days: [1, 2, 3, 4, 5], // Monday to Friday
      availableHours: [8, 9, 10, 11, 13, 14, 15] // Skip noon for lunch
    };
    
    console.log('🔧 GoogleCalendarService initialized');
    console.log('📅 Calendar ID:', this.calendarId);
    console.log('🌍 Timezone:', this.timezone);
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Calendar service...');
      
      if (!config.GOOGLE_PROJECT_ID || !config.GOOGLE_PRIVATE_KEY || !config.GOOGLE_CLIENT_EMAIL) {
        throw new Error('Missing required Google Calendar environment variables');
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Calendar service initialized successfully');
        
        const testResult = await this.testConnection();
        if (!testResult) {
          console.warn('⚠️ Calendar connection test had issues but continuing...');
        }
        return true;
      } else {
        throw new Error('Google Calendar authentication failed');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Calendar service:', error.message);
      throw error;
    }
  }

  async setupAuthentication() {
    try {
      console.log('🔐 Setting up Google Calendar authentication...');
      
      let privateKey = config.GOOGLE_PRIVATE_KEY;
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      const useImpersonation = config.GOOGLE_IMPERSONATE_EMAIL || config.GOOGLE_SUBJECT_EMAIL;
      
      if (useImpersonation) {
        console.log('🔑 Using domain-wide delegation with impersonation');
        console.log('📧 Impersonating:', config.GOOGLE_IMPERSONATE_EMAIL || config.GOOGLE_SUBJECT_EMAIL);
      }
      
      const authConfig = {
        credentials: {
          type: "service_account",
          project_id: config.GOOGLE_PROJECT_ID,
          private_key_id: config.GOOGLE_PRIVATE_KEY_ID || "key_id",
          private_key: privateKey,
          client_email: config.GOOGLE_CLIENT_EMAIL,
          client_id: config.GOOGLE_CLIENT_ID || "client_id",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
          client_x509_cert_url: `https://www.googleapis.com/oauth2/v1/certs/${encodeURIComponent(config.GOOGLE_CLIENT_EMAIL)}`
        },
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events'
        ]
      };
      
      if (useImpersonation) {
        authConfig.subject = config.GOOGLE_IMPERSONATE_EMAIL || config.GOOGLE_SUBJECT_EMAIL;
      }
      
      const authClient = new google.auth.GoogleAuth(authConfig);
      this.auth = await authClient.getClient();
      
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
      
      console.log(`✅ Connected to calendar: ${response.data.summary || this.calendarId}`);
      return true;
      
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      return false;
    }
  }

  async getAvailableSlots(date) {
    try {
      console.log('📅 Getting available slots for:', date);
      
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();
      
      // Check if it's a business day
      if (!this.businessHours.days.includes(dayOfWeek)) {
        console.log('📅 Not a business day');
        return [];
      }

      // Check if it's in the past
      const now = new Date();
      const todayInArizona = new Date(now.toLocaleString("en-US", {timeZone: this.timezone}));
      const targetInArizona = new Date(targetDate.toLocaleString("en-US", {timeZone: this.timezone}));
      
      if (targetInArizona < todayInArizona) {
        console.log('📅 Date is in the past');
        return [];
      }

      // Create date range in Arizona time
      const startOfDayAZ = new Date(targetDate);
      startOfDayAZ.setHours(0, 0, 0, 0);
      
      const endOfDayAZ = new Date(targetDate);
      endOfDayAZ.setHours(23, 59, 59, 999);

      // Convert to ISO strings for API call
      const timeMin = new Date(startOfDayAZ.toLocaleString("en-US", {timeZone: this.timezone})).toISOString();
      const timeMax = new Date(endOfDayAZ.toLocaleString("en-US", {timeZone: this.timezone})).toISOString();

      // Get existing events
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: this.timezone
      });

      const existingEvents = response.data.items || [];
      console.log(`📋 Found ${existingEvents.length} existing events`);

      // Generate available slots
      const availableSlots = [];
      const currentTimeAZ = new Date(now.toLocaleString("en-US", {timeZone: this.timezone}));
      
      for (const hour of this.businessHours.availableHours) {
        // Create slot time in Arizona timezone
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, 0, 0, 0);
        
        const slotEnd = new Date(targetDate);
        slotEnd.setHours(hour + 1, 0, 0, 0);
        
        // Skip if in the past (comparing in Arizona time)
        const slotStartAZ = new Date(slotStart.toLocaleString("en-US", {timeZone: this.timezone}));
        if (slotStartAZ <= currentTimeAZ) {
          console.log(`⏰ Skipping past time: ${hour}:00 MST`);
          continue;
        }
        
        // Check for conflicts
        const hasConflict = existingEvents.some(event => {
          if (!event.start?.dateTime) return false;
          const eventStart = new Date(event.start.dateTime);
          const eventEnd = new Date(event.end.dateTime);
          return (slotStart < eventEnd && slotEnd > eventStart);
        });

        if (!hasConflict) {
          availableSlots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`,
            arizonaTime: slotStart.toLocaleString('en-US', {
              timeZone: this.timezone,
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })
          });
          console.log(`✅ Available slot: ${hour}:00 MST (${availableSlots[availableSlots.length - 1].arizonaTime})`);
        } else {
          console.log(`❌ Slot conflict at ${hour}:00 MST`);
        }
      }

      console.log(`✅ Generated ${availableSlots.length} available slots`);
      return availableSlots;

    } catch (error) {
      console.error('❌ Error getting calendar slots:', error.message);
      throw error;
    }
  }

  async isSlotAvailable(startTime, endTime) {
    try {
      console.log(`🔍 Checking availability: ${startTime} to ${endTime}`);
      
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startTime,
        timeMax: endTime,
        singleEvents: true,
        timeZone: this.timezone
      });

      const events = response.data.items || [];
      const isAvailable = events.length === 0;
      
      console.log(`📊 Slot availability: ${isAvailable ? 'Available ✅' : 'Booked ❌'}`);
      return isAvailable;

    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      return true;
    }
  }

  async createEvent(eventDetails) {
    try {
      console.log('📅 Creating calendar event:', eventDetails.summary);
      
      // CRITICAL: Convert the provided time to ensure it's treated as Arizona time
      const startDate = new Date(eventDetails.startTime);
      const endDate = new Date(eventDetails.endTime);
      
      console.log('🕐 Requested start time:', startDate.toString());
      console.log('🕐 Start time (Arizona):', startDate.toLocaleString('en-US', { 
        timeZone: this.timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }));
      console.log('📧 Attendee:', eventDetails.attendeeEmail);

      // Validate inputs
      if (!eventDetails.attendeeEmail || eventDetails.attendeeEmail === 'prospect@example.com') {
        throw new Error('Valid attendee email required');
      }

      // Check availability first
      const isAvailable = await this.isSlotAvailable(eventDetails.startTime, eventDetails.endTime);
      if (!isAvailable) {
        return {
          success: false,
          error: 'Slot no longer available',
          message: 'That time slot has been booked'
        };
      }

      // Create the event with Arizona timezone specified
      const event = {
        summary: eventDetails.summary || 'Nexella AI Consultation Call',
        description: `${eventDetails.description || 'Discovery call scheduled via Nexella AI'}

APPOINTMENT TIME: ${startDate.toLocaleString('en-US', { 
  timeZone: this.timezone,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})} MST

CUSTOMER PHONE: ${eventDetails.attendeePhone || 'No phone provided'}
Customer Name: ${eventDetails.attendeeName || 'Not provided'}
Email: ${eventDetails.attendeeEmail}`,
        location: eventDetails.attendeePhone ? `Call: ${eventDetails.attendeePhone}` : 'Phone Call',
        start: {
          dateTime: eventDetails.startTime,
          timeZone: this.timezone // CRITICAL: Specify Arizona timezone
        },
        end: {
          dateTime: eventDetails.endTime,
          timeZone: this.timezone // CRITICAL: Specify Arizona timezone
        },
        attendees: [
          {
            email: eventDetails.attendeeEmail,
            displayName: eventDetails.attendeeName || 'Guest',
            responseStatus: 'needsAction',
            optional: false,
            comment: eventDetails.attendeePhone || ''
          }
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 1 day before
            { method: 'email', minutes: 60 },      // 1 hour before
            { method: 'popup', minutes: 30 }       // 30 minutes before
          ]
        },
        guestsCanModify: false,
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false
      };

      console.log('📅 Creating event with timezone:', this.timezone);
      
      let response;
      let eventCreated = false;
      
      // Try with email invitations if we have impersonation
      if (config.GOOGLE_IMPERSONATE_EMAIL || config.GOOGLE_SUBJECT_EMAIL) {
        try {
          response = await this.calendar.events.insert({
            calendarId: this.calendarId,
            resource: event,
            conferenceDataVersion: 1,
            sendUpdates: 'all',
            sendNotifications: true
          });
          eventCreated = true;
          console.log('✅ Event created with email invitations');
        } catch (error) {
          console.log('⚠️ Failed with impersonation, trying alternative approach');
        }
      }
      
      // Alternative approach without email invitations
      if (!eventCreated) {
        try {
          const eventWithoutAttendees = { ...event };
          delete eventWithoutAttendees.attendees;
          
          response = await this.calendar.events.insert({
            calendarId: this.calendarId,
            resource: eventWithoutAttendees,
            conferenceDataVersion: 1
          });
          
          console.log('✅ Base event created');
          
          // Try to add attendees
          try {
            const updateResponse = await this.calendar.events.patch({
              calendarId: this.calendarId,
              eventId: response.data.id,
              resource: {
                attendees: event.attendees
              },
              sendUpdates: 'all'
            });
            
            response = updateResponse;
            console.log('✅ Attendee added with email invitation');
          } catch (updateError) {
            console.log('⚠️ Could not add attendee with email:', updateError.message);
            response.data.manualInvitationRequired = true;
          }
          
          eventCreated = true;
        } catch (error) {
          // Last resort - create without sending emails
          response = await this.calendar.events.insert({
            calendarId: this.calendarId,
            resource: event,
            conferenceDataVersion: 1,
            sendUpdates: 'none'
          });
          
          eventCreated = true;
          console.log('✅ Event created without automatic email invitations');
          response.data.manualInvitationRequired = true;
        }
      }

      if (eventCreated && response?.data) {
        const createdEvent = response.data;
        const eventStartTime = new Date(createdEvent.start.dateTime);
        
        console.log('✅ Event created successfully!');
        console.log('📅 Event ID:', createdEvent.id);
        console.log('📅 Event time (MST):', eventStartTime.toLocaleString('en-US', {
          timeZone: this.timezone,
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }));
        
        const meetingLink = createdEvent.hangoutLink || 
                           createdEvent.conferenceData?.entryPoints?.[0]?.uri || '';

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
          displayTime: eventStartTime.toLocaleString('en-US', {
            timeZone: this.timezone,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }),
          timezone: this.timezone,
          manualInvitationRequired: createdEvent.manualInvitationRequired || false
        };
      } else {
        throw new Error('Event creation failed');
      }

    } catch (error) {
      console.error('❌ Error creating calendar event:', error.message);
      
      if (error.message?.includes('Domain-Wide Delegation')) {
        return {
          success: false,
          error: 'Calendar permission issue',
          message: 'Event created but email invitation requires additional setup',
          technicalDetails: 'Service account needs Domain-Wide Delegation for sending invitations'
        };
      } else if (error.response?.status === 401) {
        return {
          success: false,
          error: 'Authentication failed',
          message: 'Calendar authentication failed'
        };
      } else if (error.response?.status === 403) {
        return {
          success: false,
          error: 'Permission denied',
          message: 'Calendar permissions insufficient'
        };
      } else if (error.response?.status === 404) {
        return {
          success: false,
          error: 'Calendar not found',
          message: 'Calendar not found or not accessible'
        };
      } else {
        return {
          success: false,
          error: error.message,
          message: 'Failed to create calendar event'
        };
      }
    }
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
      impersonationEnabled: !!(config.GOOGLE_IMPERSONATE_EMAIL || config.GOOGLE_SUBJECT_EMAIL)
    };
  }
}

module.exports = GoogleCalendarService;
