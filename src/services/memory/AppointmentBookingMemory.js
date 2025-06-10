// src/services/memory/AppointmentBookingMemory.js
// This system stores booking patterns and learns from successful bookings

const RAGMemoryService = require('./RAGMemoryService');

class AppointmentBookingMemory {
  constructor() {
    this.memoryService = new RAGMemoryService();
  }

  /**
   * Store successful booking patterns for learning
   */
  async storeSuccessfulBookingPattern(userPhrase, parsedResult, customerId) {
    try {
      const bookingPattern = {
        userPhrase: userPhrase.toLowerCase(),
        parsedDay: parsedResult.dayName,
        parsedTime: parsedResult.timeString,
        parsedHour: parsedResult.hour,
        successfulMatch: true,
        timestamp: new Date().toISOString()
      };

      const memoryContent = `Successful booking pattern: User said "${userPhrase}" which means ${parsedResult.dayName} at ${parsedResult.timeString}`;
      
      const embedding = await this.memoryService.createEmbedding(memoryContent);
      
      await this.memoryService.storeMemories([{
        id: `booking_pattern_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'booking_pattern',
          customer_id: customerId,
          user_phrase: userPhrase,
          parsed_day: parsedResult.dayName,
          parsed_time: parsedResult.timeString,
          parsed_hour: parsedResult.hour,
          success: true,
          timestamp: new Date().toISOString()
        }
      }]);

      console.log('✅ Stored successful booking pattern:', bookingPattern);
    } catch (error) {
      console.error('❌ Error storing booking pattern:', error.message);
    }
  }

  /**
   * Search for similar booking patterns to help with parsing
   */
  async findSimilarBookingPatterns(userPhrase, limit = 5) {
    try {
      const results = await this.memoryService.retrieveRelevantMemories(
        null, // No specific customer
        userPhrase,
        limit
      );

      const patterns = results
        .filter(r => r.memoryType === 'booking_pattern')
        .map(r => ({
          similarPhrase: r.metadata?.user_phrase,
          parsedDay: r.metadata?.parsed_day,
          parsedTime: r.metadata?.parsed_time,
          similarity: r.score
        }));

      console.log(`🔍 Found ${patterns.length} similar booking patterns`);
      return patterns;
    } catch (error) {
      console.error('❌ Error finding booking patterns:', error.message);
      return [];
    }
  }

  /**
   * Store common booking phrases for better understanding
   */
  async ingestCommonBookingPhrases() {
    const commonPhrases = [
      { phrase: "what about thursday at nine", day: "thursday", time: "9:00 AM" },
      { phrase: "how about friday at 2", day: "friday", time: "2:00 PM" },
      { phrase: "can we do monday morning", day: "monday", time: "morning" },
      { phrase: "is tuesday afternoon available", day: "tuesday", time: "afternoon" },
      { phrase: "thursday works for me", day: "thursday", time: "any" },
      { phrase: "let's do wednesday at ten", day: "wednesday", time: "10:00 AM" },
      { phrase: "does thursday at 9 work", day: "thursday", time: "9:00 AM" },
      { phrase: "I'm free thursday morning", day: "thursday", time: "morning" },
      { phrase: "thursday at nine sounds good", day: "thursday", time: "9:00 AM" },
      { phrase: "book me for thursday 9am", day: "thursday", time: "9:00 AM" }
    ];

    for (const pattern of commonPhrases) {
      const content = `Booking phrase: "${pattern.phrase}" means ${pattern.day} at ${pattern.time}`;
      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `common_booking_${pattern.phrase.replace(/\s+/g, '_')}`,
        values: embedding,
        metadata: {
          memory_type: 'booking_phrase',
          phrase: pattern.phrase,
          day: pattern.day,
          time: pattern.time,
          source: 'common_patterns'
        }
      }]);
    }

    console.log('✅ Ingested common booking phrases');
  }

  /**
   * Learn from failed booking attempts
   */
  async storeFailedBookingAttempt(userPhrase, reason) {
    try {
      const content = `Failed booking attempt: "${userPhrase}" - Reason: ${reason}`;
      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `failed_booking_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'failed_booking',
          user_phrase: userPhrase,
          failure_reason: reason,
          timestamp: new Date().toISOString()
        }
      }]);

      console.log('📝 Stored failed booking attempt for learning');
    } catch (error) {
      console.error('❌ Error storing failed booking:', error.message);
    }
  }

  /**
   * Get booking intelligence for a phrase
   */
  async getBookingIntelligence(userPhrase) {
    try {
      // Search for similar successful patterns
      const similarPatterns = await this.findSimilarBookingPatterns(userPhrase, 3);
      
      // If we find very similar patterns, suggest the interpretation
      const highConfidenceMatch = similarPatterns.find(p => p.similarity > 0.9);
      
      if (highConfidenceMatch) {
        return {
          confident: true,
          suggestedDay: highConfidenceMatch.parsedDay,
          suggestedTime: highConfidenceMatch.parsedTime,
          reason: `Similar to: "${highConfidenceMatch.similarPhrase}"`
        };
      }

      // Check common phrases
      const queryEmbedding = await this.memoryService.createEmbedding(userPhrase);
      const commonPhrases = await this.memoryService.index.query({
        vector: queryEmbedding,
        filter: { memory_type: { $eq: 'booking_phrase' } },
        topK: 3,
        includeMetadata: true
      });

      if (commonPhrases.matches?.length > 0 && commonPhrases.matches[0].score > 0.85) {
        const match = commonPhrases.matches[0];
        return {
          confident: true,
          suggestedDay: match.metadata.day,
          suggestedTime: match.metadata.time,
          reason: 'Matches common booking pattern'
        };
      }

      return {
        confident: false,
        suggestions: similarPatterns
      };
      
    } catch (error) {
      console.error('❌ Error getting booking intelligence:', error.message);
      return { confident: false };
    }
  }
}

module.exports = AppointmentBookingMemory;
