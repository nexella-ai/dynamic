// src/services/calendar/GoogleAppointmentScheduleService.js - FIXED FOR APPOINTMENT SCHEDULES
const { google } = require('googleapis');

class GoogleAppointmentScheduleService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.timezone = process.env.TIMEZONE || 'America/Phoenix';
    
    // Extract schedule ID from your URL
    this.scheduleId = 'AcZssZ1-X85n75lz94LdlcSf5CMe2WJLxb7sML9AaKD2I7O7OaIkvdxuDUEEKEkQ7loxtQfRxsVnK__u';
    
    console.log('🔧 GoogleAppointmentScheduleService constructor called');
    console.log('📅 Schedule ID:', this.scheduleId);
    console.log('🌍 Using timezone:', this.timezone);
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Appointment Schedule service...');
      console.log('🔍 Environment Variable Check:');
      console.log('   GOOGLE_PROJECT_ID:', process.env.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_CLIENT_EMAIL:', process.env.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING');
      
      if (!process.env.GOOGLE_PROJECT_ID || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_CLIENT_EMAIL) {
        console.error('❌ Missing required Google Calendar environment variables');
        return false;
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
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
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar.appointments'
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
      
      // Test basic calendar access
      const response = await this.calendar.calendars.get({
        calendarId: 'primary'
      });
      
      console.log(`✅ Connected to calendar: ${response.data.summary}`);
      console.log(`📅 Schedule ID: ${this.scheduleId}`);
      
      const calendarTimezone = response.data.timeZone;
      console.log(`🌍 Calendar timezone: ${calendarTimezone}`);
      console.log(`🌍 Using configured timezone: ${this.timezone}`);
      
      // Test appointment schedule access
      await this.testAppointmentScheduleAccess();
      
      return true;
    } catch (error) {
      console.error('❌ Appointment schedule connection test failed:', error.message);
      return false;
    }
  }

  async testAppointmentScheduleAccess() {
    try {
      console.log('🧪 Testing appointment schedule access...');
      
      // Try to get appointment schedule info
      const scheduleResponse = await this.calendar.appointmentSchedules.get({
        name: `projects/${process.env.GOOGLE_PROJECT_ID}/locations/primary/appointmentSchedules/${this.scheduleId}`
      });
      
      console.log('✅ Appointment schedule access confirmed');
      console.log('📋 Schedule details:', scheduleResponse.data.displayName);
      
    } catch (error) {
      console.log('⚠️ Direct appointment schedule access failed, using calendar method');
      console.log('📝 This is normal - proceeding with calendar-based booking');
    }
  }

  async getAvailableSlots(date) {
    try {
      if (!this.calendar) {
        console.log('⚠️ Appointment schedule not available');
        return this.generateBusinessHourSlots(date);
      }

      console.log(`📅 [APPOINTMENT SCHEDULE] Getting available slots for: ${date}`);
      
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();
      
      // No slots on weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log('📅 Weekend - no slots available');
        return [];
      }

      // Check if it's in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate < today) {
        console.log('📅 Date is in the past, no slots available');
        return [];
      }

      // Get start and end of day
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      console.log(`🕐 Checking availability from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

      try {
        // Get existing events/bookings
        const response = await this.calendar.events.list({
          calendarId: 'primary',
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: 'startTime'
        });

        const existingEvents = response.data.items || [];
        console.log(`📋 Found ${existingEvents.length} existing events/bookings`);

        // Generate available slots based on your appointment schedule
        const availableSlots = await this.generateAppointmentSlots(targetDate, existingEvents);
        
        console.log(`✅ Generated ${availableSlots.length} available appointment slots`);
        return availableSlots;

      } catch (apiError) {
        console.error('❌ Error calling appointment schedule API:', apiError.message);
        return this.generateBusinessHourSlots(targetDate);
      }

    } catch (error) {
      console.error('❌ Error getting appointment schedule slots:', error.message);
      return this.generateBusinessHourSlots(date);
    }
  }

  async generateAppointmentSlots(targetDate, existingEvents = []) {
    try {
      console.log('🎯 Generating appointment slots based on your schedule');
      
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
      
      // Define your appointment schedule times
      // Based on typical business appointment schedules
      const appointmentHours = [9, 10, 11, 13, 14, 15, 16]; // 9AM-11AM, 1PM-4PM
      
      for (const hour of appointmentHours) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, 0, 0, 0);
        
        const slotEnd = new Date(targetDate);
        slotEnd.setHours(hour + 1, 0, 0, 0); // 1-hour appointments
        
        // If it's today, only show future times
        const now = new Date();
        if (targetDate.toDateString() === now.toDateString()) {
          if (slotStart <= now) {
            console.log(`⏰ Skipping past time: ${hour}:00`);
            continue;
          }
        }
        
        // Check for conflicts with existing events
        const hasConflict = existingEvents.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          return (slotStart < eventEnd && slotEnd > eventStart);
        });
        
        if (!hasConflict) {
          const displayTime = this.formatDisplayTime(hour);
          
          slots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: displayTime
          });
          
          console.log(`✅ Available appointment slot: ${displayTime} (${slotStart.toISOString()})`);
        } else {
          console.log(`❌ Slot conflict at ${hour}:00`);
        }
      }
      
      console.log(`🔄 Generated ${slots.length} appointment slots`);
      return slots;
      
    } catch (error) {
      console.error('❌ Error generating appointment slots:', error.message);
      return this.generateBusinessHourSlots(targetDate);
    }
  }

  // Fallback business hour generation
  generateBusinessHourSlots(targetDate) {
    console.log('🔄 Using fallback business hour slots');
    
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
    const businessHours = [9, 10, 11, 14, 15]; // 9AM, 10AM, 11AM, 2PM, 3PM
    
    businessHours.forEach(hour => {
      const slotDate = new Date(targetDate);
      slotDate.setHours(hour, 0, 0, 0);
      
      const slotEndDate = new Date(targetDate);
      slotEndDate.setHours(hour + 1, 0, 0, 0);
      
      // If it's today, only show future times
      const now = new Date();
      if (targetDate.toDateString() === now.toDateString()) {
        if (slotDate <= now) {
          return;
        }
      }
      
      const displayTime = this.formatDisplayTime(hour);
      
      slots.push({
        startTime: slotDate.toISOString(),
        endTime: slotEndDate.toISOString(),
        displayTime: displayTime
      });
    });
    
    console.log(`🔄 Generated ${slots.length} fallback business hour slots`);
    return slots;
  }

  formatDisplayTime(hour) {
    if (hour === 0) {
      return "12:00 AM";
    } else if (hour < 12) {
      return `${hour}:00 AM`;
    } else if (hour === 12) {
      return "12:00 PM";
    } else {
      return `${hour - 12}:00 PM`;
    }
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
      
      console.log(`📊 Slot availability check: ${isAvailable ? 'Available ✅' : 'Booked ❌'}`);
      return isAvailable;

    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      return true; // Assume available if can't check
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

      console.log('📅 Creating appointment via appointment schedule:', appointmentDetails.summary);
      console.log('🌍 Using timezone for event:', this.timezone);

      // First, check if the slot is still available
      const isAvailable = await this.isSlotAvailable(appointmentDetails.startTime, appointmentDetails.endTime);
      if (!isAvailable) {
        console.log('❌ Slot no longer available');
        return {
          success: false,
          error: 'Slot no longer available',
          message: 'That time slot has been booked by someone else'
        };
      }

      const event = {
        summary: appointmentDetails.summary || 'Nexella AI Consultation Call',
        description: `${appointmentDetails.description || 'Discovery call scheduled via Nexella AI'}\n\nCustomer: ${appointmentDetails.attendeeName}\nEmail: ${appointmentDetails.attendeeEmail}`,
        start: {
          dateTime: appointmentDetails.startTime,
          timeZone: this.timezone
        },
        end: {
          dateTime: appointmentDetails.endTime,
          timeZone: this.timezone
        },
        attendees: [
          {
            email: appointmentDetails.attendeeEmail,
            displayName: appointmentDetails.attendeeName,
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
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Send invitations to attendees
      });

      const createdEvent = response.data;
      console.log('✅ Appointment created successfully:', createdEvent.id);

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
        customerEmail: appointmentDetails.attendeeEmail,
        customerName: appointmentDetails.attendeeName,
        startTime: appointmentDetails.startTime,
        endTime: appointmentDetails.endTime
      };

    } catch (error) {
      console.error('❌ Error creating appointment:', error.message);
      
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
          message: 'Calendar or appointment schedule not found'
        };
      } else {
        return {
          success: false,
          error: error.message,
          message: 'Failed to create appointment'
        };
      }
    }
  }

  // Try to book using appointment schedule API if available
  async createAppointmentViaScheduleAPI(appointmentDetails) {
    try {
      console.log('📅 Attempting to book via Appointment Schedule API...');
      
      // This is for future implementation when Google adds full API support
      // For now, we use the regular calendar API
      
      const bookingRequest = {
        appointmentSchedule: `projects/${process.env.GOOGLE_PROJECT_ID}/locations/primary/appointmentSchedules/${this.scheduleId}`,
        bookingId: `booking_${Date.now()}`,
        startTime: appointmentDetails.startTime,
        endTime: appointmentDetails.endTime,
        attendees: [{
          email: appointmentDetails.attendeeEmail,
          displayName: appointmentDetails.attendeeName
        }]
      };
      
      // This API endpoint may not be fully available yet
      const response = await this.calendar.appointmentBookings.create({
        parent: `projects/${process.env.GOOGLE_PROJECT_ID}/locations/primary/appointmentSchedules/${this.scheduleId}`,
        resource: bookingRequest
      });
      
      console.log('✅ Appointment booked via Schedule API');
      return {
        success: true,
        bookingId: response.data.name,
        message: 'Appointment booked via appointment schedule'
      };
      
    } catch (error) {
      console.log('⚠️ Appointment Schedule API not available, using calendar method');
      throw error; // Fall back to calendar method
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

  // Get available time slots for multiple days
  async getAvailableSlotsForDays(startDate, numDays = 7) {
    const allSlots = [];
    
    for (let i = 0; i < numDays; i++) {
      const checkDate = new Date(startDate);
      checkDate.setDate(startDate.getDate() + i);
      
      try {
        const daySlots = await this.getAvailableSlots(checkDate);
        if (daySlots.length > 0) {
          allSlots.push({
            date: checkDate,
            dateString: checkDate.toDateString(),
            dayName: checkDate.toLocaleDateString('en-US', { weekday: 'long' }),
            slots: daySlots
          });
        }
      } catch (error) {
        console.error(`Error getting slots for ${checkDate.toDateString()}:`, error.message);
      }
    }
    
    return allSlots;
  }
}

module.exports = GoogleAppointmentScheduleService;
