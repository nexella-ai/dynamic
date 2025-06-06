// src/utils/helpers.js - Utility Helper Functions

// Format a date range for display
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

// Validate business hours
function isBusinessHours(dateTime) {
  const date = new Date(dateTime);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = date.getHours();
  
  // Monday to Friday (1-5), 9 AM to 5 PM
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour < 17;
}

// Get next business day
function getNextBusinessDay(fromDate = new Date()) {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + 1);
  
  while (date.getDay() === 0 || date.getDay() === 6) { // Skip weekends
    date.setDate(date.getDate() + 1);
  }
  
  return date;
}

// Format phone number to E.164 format
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // If it already starts with 1, assume it's US number with country code
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return `+${cleaned}`;
  }
  
  // If it's 10 digits, assume US number without country code
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // If it doesn't start with +, add it
  if (!phone.startsWith('+')) {
    return `+${cleaned}`;
  }
  
  return phone;
}

// Validate email format
function isValidEmail(email) {
  if (!email) return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Get timezone-aware date string
function getTimezoneDate(date, timezone = 'America/Phoenix') {
  try {
    return new Date(date).toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting timezone date:', error);
    return new Date(date).toLocaleDateString();
  }
}

// Get timezone-aware time string
function getTimezoneTime(date, timezone = 'America/Phoenix') {
  try {
    return new Date(date).toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (error) {
    console.error('Error formatting timezone time:', error);
    return new Date(date).toLocaleTimeString();
  }
}

// Sanitize user input
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove basic HTML characters
    .substring(0, 500); // Limit length
}

// Generate unique ID
function generateUniqueId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Retry function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Deep clone object
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}

// Check if object is empty
function isEmpty(obj) {
  if (!obj) return true;
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  if (typeof obj === 'string') return obj.trim().length === 0;
  return false;
}

// Format duration in human readable format
function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Capitalize first letter of each word
function capitalizeWords(str) {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Get day of week name
function getDayName(date) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date(date).getDay()];
}

// Check if date is today
function isToday(date) {
  const today = new Date();
  const checkDate = new Date(date);
  
  return today.getFullYear() === checkDate.getFullYear() &&
         today.getMonth() === checkDate.getMonth() &&
         today.getDate() === checkDate.getDate();
}

// Check if date is tomorrow
function isTomorrow(date) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const checkDate = new Date(date);
  
  return tomorrow.getFullYear() === checkDate.getFullYear() &&
         tomorrow.getMonth() === checkDate.getMonth() &&
         tomorrow.getDate() === checkDate.getDate();
}

// Create safe timeout with cleanup
function createSafeTimeout(callback, delay) {
  const timeoutId = setTimeout(callback, delay);
  
  return {
    id: timeoutId,
    clear: () => clearTimeout(timeoutId)
  };
}

// Log with timestamp
function logWithTimestamp(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] ${level.toUpperCase()}:`;
  
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

module.exports = {
  formatDateRange,
  isBusinessHours,
  getNextBusinessDay,
  formatPhoneNumber,
  isValidEmail,
  getTimezoneDate,
  getTimezoneTime,
  sanitizeInput,
  generateUniqueId,
  retryWithBackoff,
  deepClone,
  isEmpty,
  formatDuration,
  capitalizeWords,
  getDayName,
  isToday,
  isTomorrow,
  createSafeTimeout,
  logWithTimestamp
};