// src/utils/CallDebugger.js - Simple call debugger
const fs = require('fs').promises;
const path = require('path');

class CallDebugger {
  constructor(callId) {
    this.callId = callId;
    this.startTime = Date.now();
    this.events = [];
    this.logDir = path.join(__dirname, '../../logs');
  }

  async log(event, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      elapsed: Date.now() - this.startTime,
      event,
      data
    };
    
    this.events.push(entry);
    console.log(`📊 [${this.callId}] ${event}:`, data);
  }

  async saveLog() {
    try {
      // Ensure log directory exists
      await fs.mkdir(this.logDir, { recursive: true });
      
      const filename = `call_${this.callId}_${new Date().toISOString().split('T')[0]}.json`;
      const filepath = path.join(this.logDir, filename);
      
      const logData = {
        callId: this.callId,
        startTime: new Date(this.startTime).toISOString(),
        duration: Date.now() - this.startTime,
        events: this.events
      };
      
      await fs.writeFile(filepath, JSON.stringify(logData, null, 2));
      console.log(`💾 Call log saved: ${filename}`);
      
    } catch (error) {
      console.error('Failed to save call log:', error);
    }
  }

  getSummary() {
    const summary = {
      callId: this.callId,
      duration: Date.now() - this.startTime,
      totalEvents: this.events.length,
      phases: {},
      errors: []
    };
    
    // Count events by type
    this.events.forEach(event => {
      if (event.event.includes('error')) {
        summary.errors.push(event);
      }
      
      const phase = event.data.phase || 'unknown';
      summary.phases[phase] = (summary.phases[phase] || 0) + 1;
    });
    
    return summary;
  }
}

module.exports = CallDebugger;
