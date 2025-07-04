// src/services/webhooks/CallDeduplicationService.js
const axios = require('axios');

class CallDeduplicationService {
  constructor() {
    // Store recent calls to prevent duplicates
    this.recentCalls = new Map();
    this.callCooldownPeriod = 60000; // 1 minute cooldown
    this.maxCallAttempts = 1; // Only allow 1 call per form submission
    
    // Clean up old entries every 5 minutes
    setInterval(() => this.cleanupOldEntries(), 300000);
  }

  /**
   * Generate unique key for a form submission
   */
  generateCallKey(email, responseId) {
    return `${email}_${responseId}`;
  }

  /**
   * Check if we should allow this call
   */
  shouldAllowCall(email, responseId) {
    const key = this.generateCallKey(email, responseId);
    const now = Date.now();
    
    // Check if we've already called this person recently
    if (this.recentCalls.has(key)) {
      const callInfo = this.recentCalls.get(key);
      const timeSinceLastCall = now - callInfo.timestamp;
      
      console.log(`⏱️ Time since last call to ${email}: ${timeSinceLastCall}ms`);
      
      // If within cooldown period, don't allow
      if (timeSinceLastCall < this.callCooldownPeriod) {
        console.log(`🚫 DUPLICATE CALL BLOCKED - Already called ${email} for response ${responseId}`);
        console.log(`   Last call: ${new Date(callInfo.timestamp).toISOString()}`);
        console.log(`   Attempts: ${callInfo.attempts}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Record a call attempt
   */
  recordCallAttempt(email, responseId, callId) {
    const key = this.generateCallKey(email, responseId);
    const now = Date.now();
    
    if (this.recentCalls.has(key)) {
      const callInfo = this.recentCalls.get(key);
      callInfo.attempts += 1;
      callInfo.lastCallId = callId;
      callInfo.timestamp = now;
    } else {
      this.recentCalls.set(key, {
        email,
        responseId,
        firstCallId: callId,
        lastCallId: callId,
        attempts: 1,
        timestamp: now
      });
    }
    
    console.log(`📞 Recorded call attempt for ${email} (${responseId})`);
  }

  /**
   * Clean up old entries
   */
  cleanupOldEntries() {
    const now = Date.now();
    const expiryTime = 3600000; // 1 hour
    
    for (const [key, callInfo] of this.recentCalls.entries()) {
      if (now - callInfo.timestamp > expiryTime) {
        this.recentCalls.delete(key);
        console.log(`🧹 Cleaned up old call record: ${key}`);
      }
    }
  }

  /**
   * Get call history for debugging
   */
  getCallHistory() {
    const history = [];
    for (const [key, info] of this.recentCalls.entries()) {
      history.push({
        key,
        ...info,
        age: Date.now() - info.timestamp
      });
    }
    return history;
  }
}

// Create singleton instance
const callDeduplicationService = new CallDeduplicationService();

module.exports = callDeduplicationService;
