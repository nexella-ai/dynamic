// src/services/timezone/TimezoneHandler.js
class TimezoneHandler {
  constructor() {
    // US area code to timezone mapping
    this.areaCodeTimezones = {
      // Eastern Time
      '201': 'America/New_York', '202': 'America/New_York', '203': 'America/New_York',
      '205': 'America/New_York', '207': 'America/New_York', '212': 'America/New_York',
      '215': 'America/New_York', '216': 'America/New_York', '234': 'America/New_York',
      '239': 'America/New_York', '240': 'America/New_York', '267': 'America/New_York',
      '272': 'America/New_York', '276': 'America/New_York', '301': 'America/New_York',
      '302': 'America/New_York', '304': 'America/New_York', '305': 'America/New_York',
      '315': 'America/New_York', '321': 'America/New_York', '330': 'America/New_York',
      '331': 'America/New_York', '339': 'America/New_York', '347': 'America/New_York',
      '351': 'America/New_York', '352': 'America/New_York', '386': 'America/New_York',
      '401': 'America/New_York', '404': 'America/New_York', '407': 'America/New_York',
      '410': 'America/New_York', '412': 'America/New_York', '413': 'America/New_York',
      '419': 'America/New_York', '434': 'America/New_York', '440': 'America/New_York',
      '443': 'America/New_York', '470': 'America/New_York', '475': 'America/New_York',
      '478': 'America/New_York', '484': 'America/New_York', '508': 'America/New_York',
      '513': 'America/New_York', '516': 'America/New_York', '517': 'America/New_York',
      '518': 'America/New_York', '540': 'America/New_York', '551': 'America/New_York',
      '561': 'America/New_York', '567': 'America/New_York', '570': 'America/New_York',
      '571': 'America/New_York', '585': 'America/New_York', '586': 'America/New_York',
      '603': 'America/New_York', '607': 'America/New_York', '609': 'America/New_York',
      '610': 'America/New_York', '614': 'America/New_York', '615': 'America/New_York',
      '616': 'America/New_York', '617': 'America/New_York', '631': 'America/New_York',
      '646': 'America/New_York', '667': 'America/New_York', '678': 'America/New_York',
      '681': 'America/New_York', '703': 'America/New_York', '704': 'America/New_York',
      '706': 'America/New_York', '716': 'America/New_York', '717': 'America/New_York',
      '718': 'America/New_York', '724': 'America/New_York', '727': 'America/New_York',
      '732': 'America/New_York', '734': 'America/New_York', '740': 'America/New_York',
      '754': 'America/New_York', '757': 'America/New_York', '762': 'America/New_York',
      '770': 'America/New_York', '772': 'America/New_York', '774': 'America/New_York',
      '786': 'America/New_York', '803': 'America/New_York', '804': 'America/New_York',
      '810': 'America/New_York', '813': 'America/New_York', '814': 'America/New_York',
      '828': 'America/New_York', '843': 'America/New_York', '845': 'America/New_York',
      '848': 'America/New_York', '850': 'America/New_York', '856': 'America/New_York',
      '857': 'America/New_York', '859': 'America/New_York', '860': 'America/New_York',
      '862': 'America/New_York', '863': 'America/New_York', '864': 'America/New_York',
      '865': 'America/New_York', '878': 'America/New_York', '904': 'America/New_York',
      '908': 'America/New_York', '910': 'America/New_York', '914': 'America/New_York',
      '917': 'America/New_York', '919': 'America/New_York', '929': 'America/New_York',
      '937': 'America/New_York', '941': 'America/New_York', '947': 'America/New_York',
      '954': 'America/New_York', '959': 'America/New_York', '973': 'America/New_York',
      '980': 'America/New_York', '984': 'America/New_York',
      
      // Central Time
      '205': 'America/Chicago', '210': 'America/Chicago', '214': 'America/Chicago',
      '217': 'America/Chicago', '218': 'America/Chicago', '219': 'America/Chicago',
      '224': 'America/Chicago', '225': 'America/Chicago', '228': 'America/Chicago',
      '251': 'America/Chicago', '254': 'America/Chicago', '256': 'America/Chicago',
      '262': 'America/Chicago', '270': 'America/Chicago', '281': 'America/Chicago',
      '309': 'America/Chicago', '312': 'America/Chicago', '314': 'America/Chicago',
      '316': 'America/Chicago', '318': 'America/Chicago', '319': 'America/Chicago',
      '320': 'America/Chicago', '331': 'America/Chicago', '334': 'America/Chicago',
      '337': 'America/Chicago', '346': 'America/Chicago', '361': 'America/Chicago',
      '364': 'America/Chicago', '409': 'America/Chicago', '414': 'America/Chicago',
      '417': 'America/Chicago', '430': 'America/Chicago', '432': 'America/Chicago',
      '469': 'America/Chicago', '479': 'America/Chicago', '501': 'America/Chicago',
      '502': 'America/Chicago', '504': 'America/Chicago', '507': 'America/Chicago',
      '512': 'America/Chicago', '515': 'America/Chicago', '563': 'America/Chicago',
      '573': 'America/Chicago', '574': 'America/Chicago', '575': 'America/Chicago',
      '580': 'America/Chicago', '601': 'America/Chicago', '608': 'America/Chicago',
      '618': 'America/Chicago', '620': 'America/Chicago', '630': 'America/Chicago',
      '636': 'America/Chicago', '641': 'America/Chicago', '651': 'America/Chicago',
      '660': 'America/Chicago', '662': 'America/Chicago', '682': 'America/Chicago',
      '708': 'America/Chicago', '712': 'America/Chicago', '713': 'America/Chicago',
      '715': 'America/Chicago', '726': 'America/Chicago', '731': 'America/Chicago',
      '737': 'America/Chicago', '763': 'America/Chicago', '769': 'America/Chicago',
      '773': 'America/Chicago', '779': 'America/Chicago', '785': 'America/Chicago',
      '815': 'America/Chicago', '816': 'America/Chicago', '817': 'America/Chicago',
      '830': 'America/Chicago', '832': 'America/Chicago', '847': 'America/Chicago',
      '870': 'America/Chicago', '872': 'America/Chicago', '901': 'America/Chicago',
      '903': 'America/Chicago', '913': 'America/Chicago', '915': 'America/Chicago',
      '918': 'America/Chicago', '920': 'America/Chicago', '931': 'America/Chicago',
      '936': 'America/Chicago', '938': 'America/Chicago', '940': 'America/Chicago',
      '945': 'America/Chicago', '952': 'America/Chicago', '956': 'America/Chicago',
      '972': 'America/Chicago', '979': 'America/Chicago', '985': 'America/Chicago',
      
      // Mountain Time
      '208': 'America/Denver', '303': 'America/Denver', '307': 'America/Denver',
      '385': 'America/Denver', '406': 'America/Denver', '435': 'America/Denver',
      '505': 'America/Denver', '575': 'America/Denver', '719': 'America/Denver',
      '720': 'America/Denver', '801': 'America/Denver', '970': 'America/Denver',
      
      // Arizona (no DST)
      '480': 'America/Phoenix', '520': 'America/Phoenix', '602': 'America/Phoenix',
      '623': 'America/Phoenix', '928': 'America/Phoenix',
      
      // Pacific Time
      '206': 'America/Los_Angeles', '209': 'America/Los_Angeles', '213': 'America/Los_Angeles',
      '253': 'America/Los_Angeles', '310': 'America/Los_Angeles', '323': 'America/Los_Angeles',
      '341': 'America/Los_Angeles', '360': 'America/Los_Angeles', '408': 'America/Los_Angeles',
      '415': 'America/Los_Angeles', '424': 'America/Los_Angeles', '425': 'America/Los_Angeles',
      '442': 'America/Los_Angeles', '458': 'America/Los_Angeles', '503': 'America/Los_Angeles',
      '509': 'America/Los_Angeles', '510': 'America/Los_Angeles', '530': 'America/Los_Angeles',
      '541': 'America/Los_Angeles', '559': 'America/Los_Angeles', '562': 'America/Los_Angeles',
      '564': 'America/Los_Angeles', '619': 'America/Los_Angeles', '626': 'America/Los_Angeles',
      '628': 'America/Los_Angeles', '650': 'America/Los_Angeles', '657': 'America/Los_Angeles',
      '661': 'America/Los_Angeles', '669': 'America/Los_Angeles', '707': 'America/Los_Angeles',
      '714': 'America/Los_Angeles', '747': 'America/Los_Angeles', '760': 'America/Los_Angeles',
      '775': 'America/Los_Angeles', '805': 'America/Los_Angeles', '818': 'America/Los_Angeles',
      '831': 'America/Los_Angeles', '858': 'America/Los_Angeles', '909': 'America/Los_Angeles',
      '916': 'America/Los_Angeles', '925': 'America/Los_Angeles', '949': 'America/Los_Angeles',
      '951': 'America/Los_Angeles', '971': 'America/Los_Angeles',
      
      // Alaska
      '907': 'America/Anchorage',
      
      // Hawaii
      '808': 'Pacific/Honolulu'
    };
    
    // Timezone display names
    this.timezoneNames = {
      'America/New_York': 'Eastern Time',
      'America/Chicago': 'Central Time',
      'America/Denver': 'Mountain Time',
      'America/Phoenix': 'Arizona Time',
      'America/Los_Angeles': 'Pacific Time',
      'America/Anchorage': 'Alaska Time',
      'Pacific/Honolulu': 'Hawaii Time'
    };
  }

  /**
   * Detect timezone from phone number
   */
  detectTimezoneFromPhone(phoneNumber) {
    if (!phoneNumber) return null;
    
    // Clean phone number
    const cleaned = phoneNumber.replace(/[^\d]/g, '');
    
    // Extract area code
    let areaCode = null;
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      areaCode = cleaned.substring(1, 4);
    } else if (cleaned.length === 10) {
      areaCode = cleaned.substring(0, 3);
    } else if (cleaned.startsWith('+1') && cleaned.length === 12) {
      areaCode = cleaned.substring(2, 5);
    }
    
    if (areaCode && this.areaCodeTimezones[areaCode]) {
      const timezone = this.areaCodeTimezones[areaCode];
      console.log(`🌍 Detected timezone ${timezone} from area code ${areaCode}`);
      return timezone;
    }
    
    console.log(`⚠️ Could not detect timezone from phone: ${phoneNumber}`);
    return null;
  }

  /**
   * Get friendly timezone name
   */
  getTimezoneName(timezone) {
    return this.timezoneNames[timezone] || timezone;
  }

  /**
   * Convert time between timezones
   */
  convertTime(dateTime, fromTimezone, toTimezone) {
    // Create date in source timezone
    const date = new Date(dateTime);
    
    // Get the time in both timezones
    const fromTime = date.toLocaleString('en-US', { timeZone: fromTimezone });
    const toTime = date.toLocaleString('en-US', { timeZone: toTimezone });
    
    console.log(`🕐 Converting ${fromTime} (${this.getTimezoneName(fromTimezone)}) to ${toTime} (${this.getTimezoneName(toTimezone)})`);
    
    return {
      original: fromTime,
      converted: toTime,
      fromTimezone: this.getTimezoneName(fromTimezone),
      toTimezone: this.getTimezoneName(toTimezone)
    };
  }

  /**
   * Get current offset between user timezone and Arizona
   */
  getTimezoneOffset(userTimezone) {
    const now = new Date();
    const arizonaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
    const userTime = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));
    
    const offsetHours = (userTime - arizonaTime) / (1000 * 60 * 60);
    
    return {
      hours: offsetHours,
      description: offsetHours === 0 ? 'Same as Arizona' : 
                   offsetHours > 0 ? `${Math.abs(offsetHours)} hours ahead of Arizona` :
                   `${Math.abs(offsetHours)} hours behind Arizona`
    };
  }

  /**
   * Format appointment time for user's timezone
   */
  formatAppointmentTime(dateTime, userTimezone) {
    const date = new Date(dateTime);
    
    const userTimeString = date.toLocaleString('en-US', {
      timeZone: userTimezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    const arizonaTimeString = date.toLocaleString('en-US', {
      timeZone: 'America/Phoenix',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    return {
      userTime: userTimeString,
      arizonaTime: arizonaTimeString,
      userTimezone: this.getTimezoneName(userTimezone),
      needsConversion: userTimezone !== 'America/Phoenix'
    };
  }

  /**
   * Parse timezone from user input
   */
  parseTimezoneFromInput(userMessage) {
    const message = userMessage.toLowerCase();
    
    const timezonePatterns = [
      { pattern: /eastern|est|edt|et/i, timezone: 'America/New_York' },
      { pattern: /central|cst|cdt|ct/i, timezone: 'America/Chicago' },
      { pattern: /mountain|mst|mdt|mt/i, timezone: 'America/Denver' },
      { pattern: /pacific|pst|pdt|pt/i, timezone: 'America/Los_Angeles' },
      { pattern: /arizona|az|phoenix/i, timezone: 'America/Phoenix' }
    ];
    
    for (const { pattern, timezone } of timezonePatterns) {
      if (pattern.test(message)) {
        console.log(`🌍 User specified timezone: ${this.getTimezoneName(timezone)}`);
        return timezone;
      }
    }
    
    return null;
  }

  /**
   * Convert Arizona time to user's timezone
   */
  convertFromArizonaTime(arizonaDateTime, userTimezone) {
    // Arizona doesn't observe DST, so we need to be careful
    const date = new Date(arizonaDateTime);
    
    // Get offset difference
    const offset = this.getTimezoneOffset(userTimezone);
    
    // Adjust the time
    const userDate = new Date(date.getTime() + (offset.hours * 60 * 60 * 1000));
    
    return userDate;
  }

  /**
   * Convert user's timezone to Arizona time
   */
  convertToArizonaTime(userDateTime, userTimezone) {
    // Convert in the opposite direction
    const date = new Date(userDateTime);
    
    // Get offset difference
    const offset = this.getTimezoneOffset(userTimezone);
    
    // Adjust the time (subtract the offset)
    const arizonaDate = new Date(date.getTime() - (offset.hours * 60 * 60 * 1000));
    
    return arizonaDate;
  }
}

module.exports = TimezoneHandler;
