// slot-manager.js
// Simple in-memory slot management system

const lockedSlots = new Map(); // Map of startTime -> { userId, endTime, timestamp }

/**
 * Lock a time slot for a specific user
 * @param {string} startTime - ISO string of start time
 * @param {string} userId - User identifier
 * @param {string} endTime - ISO string of end time (optional)
 * @returns {boolean} - True if slot was successfully locked
 */
function lockSlot(startTime, userId, endTime = null) {
  try {
    // Check if slot is already locked
    if (lockedSlots.has(startTime)) {
      console.log(`Slot ${startTime} is already locked`);
      return false;
    }

    // Lock the slot
    lockedSlots.set(startTime, {
      userId,
      endTime: endTime || new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(), // Default 1 hour
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Slot locked: ${startTime} for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error locking slot:', error);
    return false;
  }
}

/**
 * Confirm a locked slot
 * @param {string} startTime - ISO string of start time
 * @param {string} userId - User identifier
 * @returns {boolean} - True if slot was successfully confirmed
 */
function confirmSlot(startTime, userId) {
  try {
    const slot = lockedSlots.get(startTime);
    
    if (!slot) {
      console.log(`No slot found for ${startTime}`);
      return false;
    }

    if (slot.userId !== userId) {
      console.log(`Slot ${startTime} is locked by different user`);
      return false;
    }

    // Mark as confirmed (you could add a confirmed flag if needed)
    slot.confirmed = true;
    slot.confirmedAt = new Date().toISOString();
    
    console.log(`✅ Slot confirmed: ${startTime} for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error confirming slot:', error);
    return false;
  }
}

/**
 * Release a locked slot
 * @param {string} startTime - ISO string of start time
 * @param {string} userId - User identifier
 * @returns {boolean} - True if slot was successfully released
 */
function releaseSlot(startTime, userId) {
  try {
    const slot = lockedSlots.get(startTime);
    
    if (!slot) {
      console.log(`No slot found for ${startTime}`);
      return false;
    }

    if (slot.userId !== userId) {
      console.log(`Cannot release slot ${startTime} - locked by different user`);
      return false;
    }

    lockedSlots.delete(startTime);
    console.log(`✅ Slot released: ${startTime} for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error releasing slot:', error);
    return false;
  }
}

/**
 * Check if a time slot is available
 * @param {string} startTime - ISO string of start time
 * @param {string} endTime - ISO string of end time
 * @returns {boolean} - True if slot is available
 */
function isSlotAvailable(startTime, endTime) {
  try {
    // Simple check - see if start time is locked
    const isLocked = lockedSlots.has(startTime);
    
    if (isLocked) {
      const slot = lockedSlots.get(startTime);
      // Check if lock has expired (optional - 30 minute lock timeout)
      const lockAge = new Date() - new Date(slot.timestamp);
      if (lockAge > 30 * 60 * 1000) { // 30 minutes
        lockedSlots.delete(startTime);
        console.log(`Expired lock removed for ${startTime}`);
        return true;
      }
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking slot availability:', error);
    return false;
  }
}

/**
 * Get available time slots for a given date
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {Array} - Array of available time slots
 */
function getAvailableSlots(date) {
  try {
    const slots = [];
    const baseDate = new Date(date);
    
    // Generate slots from 9 AM to 5 PM (business hours)
    for (let hour = 9; hour < 17; hour++) {
      const slotTime = new Date(baseDate);
      slotTime.setHours(hour, 0, 0, 0);
      const startTime = slotTime.toISOString();
      
      if (isSlotAvailable(startTime)) {
        slots.push({
          startTime,
          endTime: new Date(slotTime.getTime() + 60 * 60 * 1000).toISOString(), // 1 hour slots
          available: true
        });
      }
    }

    console.log(`Found ${slots.length} available slots for ${date}`);
    return slots;
  } catch (error) {
    console.error('Error getting available slots:', error);
    return [];
  }
}

/**
 * Clean up expired locks (call this periodically)
 */
function cleanupExpiredLocks() {
  const now = new Date();
  const expiredSlots = [];

  for (const [startTime, slot] of lockedSlots.entries()) {
    const lockAge = now - new Date(slot.timestamp);
    if (lockAge > 30 * 60 * 1000) { // 30 minutes
      expiredSlots.push(startTime);
    }
  }

  expiredSlots.forEach(startTime => {
    lockedSlots.delete(startTime);
    console.log(`Cleaned up expired lock for ${startTime}`);
  });

  if (expiredSlots.length > 0) {
    console.log(`Cleaned up ${expiredSlots.length} expired locks`);
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredLocks, 10 * 60 * 1000);

module.exports = {
  lockSlot,
  confirmSlot,
  releaseSlot,
  isSlotAvailable,
  getAvailableSlots,
  cleanupExpiredLocks
};
