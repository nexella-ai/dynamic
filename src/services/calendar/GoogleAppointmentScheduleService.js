// src/services/calendar/GoogleAppointmentScheduleService.js - Fixed Timezone
const { google } = require('googleapis');

class GoogleAppointmentScheduleService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    // FIXED: Always use environment variable timezone, don't let calendar override it
    this.timezone = process.env.TIMEZONE || 'America/Phoenix';
    
    // Extract schedule ID from your URL
    this.scheduleId = 'AcZssZ1-X85n75lz94LdlcSf5CMe2WJLxb7sML9AaKD2I7O7OaIkvdxuDUEEKEkQ7loxtQfRxsVnK__u';
    this.scheduleName = `projects/${process.env.GOOGLE_PROJECT_ID}/locations/us-central1/bookingConfigs/${this.scheduleId}`;
    
    console.log('🔧 GoogleAppointmentScheduleService constructor called');
    console.log('📅 Schedule ID:', this.scheduleId);
    console.log('🌍 Using timezone:', this.timezone); // Show timezone from constructor
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Appointment Schedule service...');
      console.log('🔍 Environment Variable Check:');
      console.log('   GOOGLE_PROJECT_ID:', process.env.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_CLIENT_EMAIL:', process.env.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING');
      console.log('   TIMEZONE:', process.env.TIMEZONE ? `✅ SET (${process.env.TIMEZONE})` : '❌ MISSING');
      
      if (!process.env.GOOGLE_PROJECT_ID || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_CLIENT_EMAIL) {
        console.error('❌ Missing required Google Calendar environment variables');
        return false;
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
        // For appointment schedules, we use the Calendar API but with different endpoints
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Appointment Schedule service initialized successfully');
        
        const testResult = await this.testConnection();
        return testResult;
      } else {
        console.warn('⚠️ Google Calendar authentication failed');
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Appointment Schedule service:', error.message);
      return false;
    }
  }

  async setupAuthentication() {
    try {
      console.log('🔐 Setting up Google Calendar authentication...');
      
      const serviceAccountKey = {
        type: "service_account",
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "dummy_key_id",
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID || "dummy_client_id",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/oauth2/v1/certs/${encodeURIComponent(process.env.GOOGLE_CLIENT_EMAIL)}`
      };
      
      console.log('📧 Service account email:', serviceAccountKey.client_email);
      console.log('🏗️ Project ID:', serviceAccountKey.project_id);
      
      this.auth = new google.auth.GoogleAuth({
        credentials: serviceAccountKey,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.readonly'
        ]
      });
      
      console.log('✅ Authentication configured successfully');
      return;
      
    } catch (error) {
      console.error('❌ Authentication setup failed:', error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Appointment Schedule connection...');
      
      // Test basic calendar access first
      const response = await this.calendar.calendars.get({
        calendarId: 'primary'
      });
      
      console.log(`✅ Connected to calendar: ${response.data.summary}`);
      console.log(`📅 Schedule ID: ${this.scheduleId}`);
      
      // FIXED: Don't override timezone from calendar - keep environment variable
      const calendarTimezone = response.data.timeZone;
      console.log(`🌍 Calendar timezone: ${calendarTimezone}`);
      console.log(`🌍 Using configured timezone: ${this.timezone} (from environment)`);
      
      // Only use calendar timezone if we don't have one configured
      if (!process.env.TIMEZONE && calendarTimezone) {
        this.timezone = calendarTimezone;
        console.log(`🌍 Updated to calendar timezone: ${this.timezone}`);
      }
      
      return true;
    } catch (error) {
      console.error('❌ Appointment schedule connection test failed:', error.message);
      return false;
    }
  }

  async getAvailableSlots(date) {
    try {
      if (!this.calendar) {
        console.log('⚠️ Appointment schedule not available');
        return this.generateBusinessHourSlots(date);
      }

      console.log(`📅 [APPOINTMENT SCHEDULE] Getting available slots for: ${date}`);
      console.log(`🌍 Using timezone: ${this.timezone}`);
      
      const targetDate = new Date(date);
      
      // Check if it's in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate < today) {
        console.log('📅 Date is in the past, no slots available');
        return [];
      }

      // For appointment schedules, we need to check the specific calendar
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      console.log(`🕐 [APPOINTMENT SCHEDULE] Checking from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

      try {
        // Get events from the calendar
        const response = await this.calendar.events.list({
          calendarId: 'primary',
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: 'startTime'
        });

        const events = response.data.items || [];
        console.log(`📋 [APPOINTMENT SCHEDULE] Found ${events.length} existing events`);

        // Generate slots based on your business hours and existing events
        const availableSlots = this.generateSlotsWithConflictCheck(targetDate, events);
        
        console.log(`✅ [APPOINTMENT SCHEDULE] Generated ${availableSlots.length} available slots`);
        return availableSlots;

      } catch (apiError) {
        console.error('❌ Error calling appointment schedule API:', apiError.message);
        
        // Fallback to business hour generation
        console.log('🔄 Falling back to business hour generation');
        return this.generateBusinessHourSlots(targetDate);
      }

    } catch (error) {
      console.error('❌ Error getting appointment schedule slots:', error.message);
      return this.generateBusinessHourSlots(date);
    }
  }

  generateSlotsWithConflictCheck(targetDate, existingEvents) {
    const dayOfWeek = targetDate.getDay();
    
    // No slots on weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [];
    }
    
    const slots = [];
    
    // Business hours: 9 AM to 5 PM (Arizona time)
    const businessStart = 9;
    const businessEnd = 17;
    
    for (let hour = businessStart; hour < businessEnd; hour++) {
      const slotStart = new Date(targetDate);
      slotStart.setHours(hour, 0, 0, 0);
      
      const slotEnd = new Date(targetDate);
      slotEnd.setHours(hour + 1, 0, 0, 0);
      
      // If it's today, only show future times
      const now = new Date();
      if (targetDate.toDateString() === now.toDateString() && slotStart <= now) {
        continue;
      }
      
      // Check for conflicts with existing events
      const hasConflict = existingEvents.some(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        return (slotStart < eventEnd && slotEnd > eventStart);
      });
      
      if (!hasConflict) {
        slots.push({
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          displayTime: slotStart.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: this.timezone // Use our configured timezone
          })
        });
      }
    }
    
    return slots;
  }

  generateBusinessHourSlots(targetDate) {
    const dayOfWeek = targetDate.getDay();
    
    // No slots on weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [];
    }
    
    // Check if it's in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetDate < today) {
      return [];
    }
    
    const slots = [];
    
    // Generate slots every hour from 9 AM to 5 PM (Arizona time)
    const availableHours = [9, 10, 11, 12, 13, 14, 15, 16]; // 9 AM to 4 PM
    
    availableHours.forEach(hour => {
      const slotTime = new Date(targetDate);
      slotTime.setHours(hour, 0, 0, 0);
      
      // If it's today, only show future times
      if (targetDate.toDateString() === today.toDateString()) {
        const now = new Date();
        if (slotTime <= now) return;
      }
      
      const endTime = new Date(slotTime);
      endTime.setHours(hour + 1);
      
      slots.push({
        startTime: slotTime.toISOString(),
        endTime: endTime.toISOString(),
        displayTime: slotTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: this.timezone // Use our configured timezone
        })
      });
    });
    
    console.log(`🔄 Generated ${slots.length} business hour slots in ${this.timezone}`);
    return slots;
  }

  async isSlotAvailable(startTime, endTime) {
    try {
      if (!this.calendar) {
        console.log('⚠️ Appointment schedule not available for availability check');
        return true;
      }

      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: startTime,
        timeMax: endTime,
        singleEvents: true
      });

      const events = response.data.items || [];
      const isAvailable = events.length === 0;
      
      console.log(`📊 [APPOINTMENT SCHEDULE] Slot availability: ${isAvailable ? 'Available ✅' : 'Not Available ❌'}`);
      return isAvailable;

    } catch (error) {
      console.error('❌ Error checking appointment schedule slot availability:', error.message);
      return true;
    }
  }

  async createAppointment(appointmentDetails) {
    try {
      if (!this.calendar) {
        console.log('⚠️ Appointment schedule not available, cannot create appointment');
        return {
          success: false,
          error: 'Appointment schedule not available',
          message: 'Cannot create appointment - schedule not configured'
        };
      }

      console.log('📅 [APPOINTMENT SCHEDULE] Creating appointment:', appointmentDetails.summary);
      console.log('🌍 Using timezone for event:', this.timezone);

      // Create a calendar event
      const event = {
        summary: appointmentDetails.summary || 'Nexella AI Consultation Call',
        description: `${appointmentDetails.description || 'Discovery call scheduled via Nexella AI'}\n\nCustomer: ${appointmentDetails.attendeeName}\nEmail: ${appointmentDetails.attendeeEmail}`,
        start: {
          dateTime: appointmentDetails.startTime,
          timeZone: this.timezone // Use our configured timezone
        },
        end: {
          dateTime: appointmentDetails.endTime,
          timeZone: this.timezone // Use our configured timezone
        },
        attendees: [
          {
            email: appointmentDetails.attendeeEmail,
            displayName: appointmentDetails.attendeeName
          }
        ],
        conferenceData: {
          createRequest: {
            requestId: `meet_${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        }
      };

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });

      const createdEvent = response.data;
      console.log('✅ [APPOINTMENT SCHEDULE] Event created:', createdEvent.id);

      return {
        success: true,
        eventId: createdEvent.id,
        meetingLink: createdEvent.conferenceData?.entryPoints?.[0]?.uri || createdEvent.hangoutLink,
        eventLink: createdEvent.htmlLink,
        message: 'Appointment created successfully',
        customerEmail: appointmentDetails.attendeeEmail,
        customerName: appointmentDetails.attendeeName
      };

    } catch (error) {
      console.error('❌ Error creating appointment:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create appointment'
      };
    }
  }

  isInitialized() {
    return !!(this.calendar && this.auth);
  }

  getScheduleInfo() {
    return {
      scheduleId: this.scheduleId,
      timezone: this.timezone,
      initialized: this.isInitialized(),
      hasAuth: !!this.auth,
      hasCalendar: !!this.calendar,
      scheduleUrl: `https://calendar.google.com/calendar/u/0/appointments/schedules/${this.scheduleId}`
    };
  }
}

module.exports = GoogleAppointmentScheduleService;
