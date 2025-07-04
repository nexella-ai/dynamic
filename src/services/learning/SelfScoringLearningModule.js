// src/services/learning/SelfScoringLearningModule.js
const RAGMemoryService = require('../memory/RAGMemoryService');
const axios = require('axios');
const config = require('../../config/environment');

class SelfScoringLearningModule {
  constructor() {
    this.memoryService = new RAGMemoryService();
    
    // Scoring criteria with weights
    this.scoringCriteria = {
      appointmentBooked: { weight: 30, maxScore: 100 },
      questionsCompleted: { weight: 20, maxScore: 100 },
      responseTime: { weight: 15, maxScore: 100 },
      conversationFlow: { weight: 15, maxScore: 100 },
      customerEngagement: { weight: 10, maxScore: 100 },
      painPointAddressed: { weight: 10, maxScore: 100 }
    };
    
    // Learning parameters
    this.learningRate = 0.1;
    this.improvementThreshold = 0.7; // 70% score threshold
  }

  /**
   * Score a completed call based on multiple criteria
   */
  async scoreCall(callData) {
    console.log('🎯 Scoring call:', callData.callId);
    
    const scores = {
      appointmentBooked: this.scoreAppointmentBooking(callData),
      questionsCompleted: this.scoreDiscoveryCompletion(callData),
      responseTime: this.scoreResponseTimes(callData),
      conversationFlow: this.scoreConversationFlow(callData),
      customerEngagement: this.scoreCustomerEngagement(callData),
      painPointAddressed: this.scorePainPointHandling(callData)
    };
    
    // Calculate weighted total score
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const [criterion, score] of Object.entries(scores)) {
      const weight = this.scoringCriteria[criterion].weight;
      totalScore += (score * weight) / 100;
      totalWeight += weight;
    }
    
    const finalScore = (totalScore / totalWeight) * 100;
    
    const scoringResult = {
      callId: callData.callId,
      timestamp: new Date().toISOString(),
      finalScore: Math.round(finalScore),
      detailedScores: scores,
      strengths: this.identifyStrengths(scores),
      improvements: this.identifyImprovements(scores),
      learningPoints: await this.generateLearningPoints(callData, scores)
    };
    
    // Store scoring result for future learning
    await this.storeScoringResult(scoringResult, callData);
    
    return scoringResult;
  }

  /**
   * Score appointment booking success
   */
  scoreAppointmentBooking(callData) {
    if (callData.appointmentBooked) {
      return 100; // Full score for successful booking
    } else if (callData.schedulingOffered) {
      return 50; // Partial score for offering scheduling
    } else if (callData.conversationPhase === 'discovery' && callData.questionsCompleted >= 4) {
      return 30; // Some score for good discovery
    }
    return 0;
  }

  /**
   * Score discovery question completion
   */
  scoreDiscoveryCompletion(callData) {
    const totalQuestions = 6;
    const completed = callData.questionsCompleted || 0;
    
    // Non-linear scoring - reward completing more questions
    if (completed === totalQuestions) return 100;
    if (completed >= 5) return 85;
    if (completed >= 4) return 70;
    if (completed >= 3) return 50;
    if (completed >= 2) return 30;
    if (completed >= 1) return 15;
    return 0;
  }

  /**
   * Score response times
   */
  scoreResponseTimes(callData) {
    const avgResponseTime = callData.averageResponseTime || 5000;
    
    // Ideal response time is 2-3 seconds
    if (avgResponseTime <= 2000) return 90; // Too fast might seem robotic
    if (avgResponseTime <= 3000) return 100; // Perfect
    if (avgResponseTime <= 4000) return 85;
    if (avgResponseTime <= 5000) return 70;
    if (avgResponseTime <= 7000) return 50;
    if (avgResponseTime <= 10000) return 30;
    return 10;
  }

  /**
   * Score conversation flow naturalness
   */
  scoreConversationFlow(callData) {
    let score = 100;
    
    // Deduct points for issues
    if (callData.repeatedQuestions > 0) {
      score -= (callData.repeatedQuestions * 10);
    }
    
    if (callData.abruptTransitions > 0) {
      score -= (callData.abruptTransitions * 15);
    }
    
    if (callData.missedCues > 0) {
      score -= (callData.missedCues * 20);
    }
    
    // Bonus for smooth transitions
    if (callData.smoothTransitions > 3) {
      score += 10;
    }
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score customer engagement level
   */
  scoreCustomerEngagement(callData) {
    const responseLength = callData.averageUserResponseLength || 10;
    const engagementSignals = callData.positiveEngagementSignals || 0;
    const disengagementSignals = callData.negativeEngagementSignals || 0;
    
    let score = 50; // Base score
    
    // Longer responses indicate engagement
    if (responseLength > 30) score += 20;
    else if (responseLength > 20) score += 15;
    else if (responseLength > 10) score += 10;
    
    // Engagement signals
    score += (engagementSignals * 5);
    score -= (disengagementSignals * 10);
    
    // Call duration factor
    if (callData.duration > 300) score += 10; // Calls over 5 minutes
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score pain point handling
   */
  scorePainPointHandling(callData) {
    if (!callData.painPoint) return 0;
    
    let score = 0;
    
    // Was pain point acknowledged?
    if (callData.painPointAcknowledged) score += 30;
    
    // Was solution presented?
    if (callData.solutionPresented) score += 40;
    
    // Were relevant services recommended?
    if (callData.servicesRecommended && callData.servicesRecommended.length > 0) {
      score += 30;
    }
    
    return Math.min(100, score);
  }

  /**
   * Identify strengths from scores
   */
  identifyStrengths(scores) {
    const strengths = [];
    
    for (const [criterion, score] of Object.entries(scores)) {
      if (score >= 80) {
        strengths.push({
          area: criterion,
          score: score,
          feedback: this.getStrengthFeedback(criterion, score)
        });
      }
    }
    
    return strengths;
  }

  /**
   * Identify areas for improvement
   */
  identifyImprovements(scores) {
    const improvements = [];
    
    for (const [criterion, score] of Object.entries(scores)) {
      if (score < 70) {
        improvements.push({
          area: criterion,
          score: score,
          suggestion: this.getImprovementSuggestion(criterion, score),
          priority: score < 50 ? 'high' : 'medium'
        });
      }
    }
    
    return improvements.sort((a, b) => a.score - b.score);
  }

  /**
   * Generate specific learning points from the call
   */
  async generateLearningPoints(callData, scores) {
    const learningPoints = [];
    
    // Analyze successful patterns
    if (scores.appointmentBooked === 100) {
      const bookingPattern = {
        type: 'successful_booking_pattern',
        pattern: {
          questionsBeforeBooking: callData.questionsCompleted,
          timeToBooking: callData.timeToBooking,
          keyPhrases: await this.extractKeyPhrases(callData.transcript, 'booking')
        },
        recommendation: 'Replicate this pattern for similar customer profiles'
      };
      learningPoints.push(bookingPattern);
    }
    
    // Analyze conversation flow patterns
    if (scores.conversationFlow >= 80) {
      const flowPattern = {
        type: 'effective_conversation_flow',
        pattern: {
          transitionPhrases: await this.extractTransitionPhrases(callData.transcript),
          questionSequence: callData.questionSequence,
          responsePatterns: callData.effectiveResponses
        },
        recommendation: 'Use these transition phrases more often'
      };
      learningPoints.push(flowPattern);
    }
    
    // Analyze pain point handling
    if (scores.painPointAddressed >= 80) {
      const painPointPattern = {
        type: 'effective_pain_point_handling',
        pattern: {
          painPoint: callData.painPoint,
          acknowledgmentPhrase: callData.painPointAcknowledgmentPhrase,
          solutionPresentation: callData.solutionPresentationMethod,
          servicesMatched: callData.servicesRecommended
        },
        recommendation: 'Apply this solution mapping to similar pain points'
      };
      learningPoints.push(painPointPattern);
    }
    
    // Identify what didn't work
    if (scores.appointmentBooked < 50 && callData.bookingAttempted) {
      const failurePattern = {
        type: 'unsuccessful_booking_pattern',
        pattern: {
          blockers: await this.identifyBookingBlockers(callData),
          customerObjections: callData.objections,
          missedOpportunities: callData.missedBookingOpportunities
        },
        recommendation: 'Avoid these patterns and address objections differently'
      };
      learningPoints.push(failurePattern);
    }
    
    return learningPoints;
  }

  /**
   * Store scoring result and learning points in RAG memory
   */
  async storeScoringResult(scoringResult, callData) {
    try {
      // Create comprehensive learning document
      const learningContent = `Call ${callData.callId} scored ${scoringResult.finalScore}/100.
Customer: ${callData.customerName} from ${callData.companyName}.
Pain Point: ${callData.painPoint}.
Outcome: ${callData.appointmentBooked ? 'Appointment booked' : 'No appointment'}.
Strengths: ${scoringResult.strengths.map(s => s.area).join(', ')}.
Improvements needed: ${scoringResult.improvements.map(i => i.area).join(', ')}.
Key learnings: ${scoringResult.learningPoints.map(lp => lp.recommendation).join('. ')}`;

      const embedding = await this.memoryService.createEmbedding(learningContent);
      
      await this.memoryService.storeMemories([{
        id: `call_scoring_${callData.callId}_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'call_scoring',
          call_id: callData.callId,
          customer_email: callData.customerEmail,
          final_score: scoringResult.finalScore,
          appointment_booked: callData.appointmentBooked,
          strengths: JSON.stringify(scoringResult.strengths),
          improvements: JSON.stringify(scoringResult.improvements),
          learning_points: JSON.stringify(scoringResult.learningPoints),
          timestamp: scoringResult.timestamp,
          content: learningContent
        }
      }]);
      
      // Store successful patterns separately for easier retrieval
      if (scoringResult.finalScore >= this.improvementThreshold * 100) {
        await this.storeSuccessfulPatterns(scoringResult, callData);
      }
      
      console.log('✅ Scoring result and learnings stored successfully');
      
    } catch (error) {
      console.error('❌ Error storing scoring result:', error);
    }
  }

  /**
   * Store successful patterns for replication
   */
  async storeSuccessfulPatterns(scoringResult, callData) {
    for (const learningPoint of scoringResult.learningPoints) {
      if (learningPoint.type.includes('successful') || learningPoint.type.includes('effective')) {
        const patternContent = `Successful pattern: ${learningPoint.type}.
Industry: ${callData.industry}.
Pain Point: ${callData.painPoint}.
Pattern: ${JSON.stringify(learningPoint.pattern)}.
Recommendation: ${learningPoint.recommendation}`;

        const embedding = await this.memoryService.createEmbedding(patternContent);
        
        await this.memoryService.storeMemories([{
          id: `success_pattern_${learningPoint.type}_${Date.now()}`,
          values: embedding,
          metadata: {
            memory_type: 'success_pattern',
            pattern_type: learningPoint.type,
            industry: callData.industry,
            pain_point: callData.painPoint,
            pattern_data: JSON.stringify(learningPoint.pattern),
            recommendation: learningPoint.recommendation,
            source_call: callData.callId,
            score: scoringResult.finalScore,
            timestamp: new Date().toISOString()
          }
        }]);
      }
    }
  }

  /**
   * Learn from historical calls and improve strategies
   */
  async learnFromHistory(limit = 100) {
    try {
      console.log('📚 Learning from historical call data...');
      
      // Retrieve recent call scorings
      const recentScorings = await this.memoryService.index.query({
        vector: new Array(3072).fill(0),
        filter: {
          memory_type: { $eq: 'call_scoring' }
        },
        topK: limit,
        includeMetadata: true
      });
      
      // Analyze patterns
      const insights = this.analyzeHistoricalPatterns(recentScorings);
      
      // Generate improvement strategies
      const strategies = await this.generateImprovementStrategies(insights);
      
      // Store new learnings
      await this.storeLearnedStrategies(strategies);
      
      return {
        insights,
        strategies,
        callsAnalyzed: recentScorings.matches?.length || 0
      };
      
    } catch (error) {
      console.error('❌ Error learning from history:', error);
      return null;
    }
  }

  /**
   * Analyze historical patterns
   */
  analyzeHistoricalPatterns(scorings) {
    const insights = {
      averageScore: 0,
      successRate: 0,
      commonStrengths: {},
      commonWeaknesses: {},
      industryPerformance: {},
      painPointSuccess: {}
    };
    
    let totalScore = 0;
    let successfulCalls = 0;
    
    scorings.matches?.forEach(match => {
      const metadata = match.metadata;
      
      // Calculate averages
      totalScore += metadata.final_score || 0;
      if (metadata.appointment_booked) successfulCalls++;
      
      // Track strengths and weaknesses
      try {
        const strengths = JSON.parse(metadata.strengths || '[]');
        const improvements = JSON.parse(metadata.improvements || '[]');
        
        strengths.forEach(s => {
          insights.commonStrengths[s.area] = (insights.commonStrengths[s.area] || 0) + 1;
        });
        
        improvements.forEach(i => {
          insights.commonWeaknesses[i.area] = (insights.commonWeaknesses[i.area] || 0) + 1;
        });
      } catch (e) {
        // Skip if JSON parsing fails
      }
    });
    
    const totalCalls = scorings.matches?.length || 1;
    insights.averageScore = totalScore / totalCalls;
    insights.successRate = (successfulCalls / totalCalls) * 100;
    
    return insights;
  }

  /**
   * Generate improvement strategies based on insights
   */
  async generateImprovementStrategies(insights) {
    const strategies = [];
    
    // Address common weaknesses
    for (const [weakness, count] of Object.entries(insights.commonWeaknesses)) {
      if (count > 5) { // If weakness appears in more than 5 calls
        strategies.push({
          area: weakness,
          priority: 'high',
          strategy: this.getImprovementStrategy(weakness),
          expectedImpact: this.estimateImpact(weakness, insights)
        });
      }
    }
    
    // Leverage strengths
    for (const [strength, count] of Object.entries(insights.commonStrengths)) {
      if (count > 10) { // If strength is consistent
        strategies.push({
          area: strength,
          priority: 'medium',
          strategy: `Continue leveraging strong ${strength} performance`,
          type: 'reinforcement'
        });
      }
    }
    
    return strategies;
  }

  /**
   * Get improvement strategy for specific area
   */
  getImprovementStrategy(area) {
    const strategies = {
      appointmentBooked: 'Focus on creating urgency and offering specific time slots earlier in conversation',
      questionsCompleted: 'Improve transition phrases between questions and make discovery more conversational',
      responseTime: 'Optimize response generation to maintain 2-3 second response times',
      conversationFlow: 'Use more natural transitions and avoid abrupt topic changes',
      customerEngagement: 'Ask more open-ended questions and show genuine interest in responses',
      painPointAddressed: 'Develop better pain point acknowledgment phrases and solution mappings'
    };
    
    return strategies[area] || 'Analyze successful calls in this area for patterns';
  }

  /**
   * Apply learnings to current conversation
   */
  async getOptimalStrategy(customerProfile, currentPhase) {
    try {
      // Find similar successful interactions
      const query = `${customerProfile.industry} ${customerProfile.painPoint} ${currentPhase} successful strategy`;
      const embedding = await this.memoryService.createEmbedding(query);
      
      const similarSuccesses = await this.memoryService.index.query({
        vector: embedding,
        filter: {
          memory_type: { $eq: 'success_pattern' },
          score: { $gte: 80 }
        },
        topK: 3,
        includeMetadata: true
      });
      
      if (similarSuccesses.matches?.length > 0) {
        // Return the most relevant successful pattern
        const bestMatch = similarSuccesses.matches[0];
        return {
          strategy: bestMatch.metadata.recommendation,
          pattern: JSON.parse(bestMatch.metadata.pattern_data || '{}'),
          confidence: bestMatch.score,
          source: bestMatch.metadata.source_call
        };
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ Error getting optimal strategy:', error);
      return null;
    }
  }

  /**
   * Real-time conversation adjustment based on learnings
   */
  async suggestNextBestAction(conversationState) {
    const currentScore = await this.calculateLiveScore(conversationState);
    
    if (currentScore < 60) {
      // Find similar low-scoring situations that were recovered
      const recovery = await this.findRecoveryPatterns(conversationState);
      
      if (recovery) {
        return {
          action: recovery.action,
          reasoning: recovery.reasoning,
          confidence: recovery.confidence
        };
      }
    }
    
    // Get optimal strategy for current phase
    const strategy = await this.getOptimalStrategy(
      conversationState.customerProfile,
      conversationState.phase
    );
    
    return strategy || { action: 'continue_current_approach', confidence: 0.5 };
  }

  // Helper methods
  
  getStrengthFeedback(criterion, score) {
    const feedback = {
      appointmentBooked: 'Excellent appointment booking rate',
      questionsCompleted: 'Great discovery completion',
      responseTime: 'Optimal response timing',
      conversationFlow: 'Natural conversation flow',
      customerEngagement: 'High customer engagement',
      painPointAddressed: 'Effective pain point handling'
    };
    return feedback[criterion] || 'Strong performance';
  }

  getImprovementSuggestion(criterion, score) {
    const suggestions = {
      appointmentBooked: 'Try offering specific time slots earlier and create more urgency',
      questionsCompleted: 'Make discovery questions more conversational and relevant',
      responseTime: 'Optimize response generation for 2-3 second timing',
      conversationFlow: 'Use smoother transitions between topics',
      customerEngagement: 'Ask more engaging questions and show empathy',
      painPointAddressed: 'Better acknowledge pain points and present targeted solutions'
    };
    return suggestions[criterion] || 'Focus on improving this area';
  }

  async extractKeyPhrases(transcript, context) {
    // Extract key phrases that led to success
    // This would analyze transcript for patterns
    return ['Let me check our calendar', 'What time works best for you?'];
  }

  async extractTransitionPhrases(transcript) {
    // Extract smooth transition phrases
    return ['That makes sense', 'I understand', 'Speaking of which'];
  }

  async identifyBookingBlockers(callData) {
    // Identify what prevented booking
    return ['Customer asked for pricing first', 'Timing concerns mentioned'];
  }

  estimateImpact(area, insights) {
    // Estimate potential score improvement
    const currentAvg = insights.averageScore;
    const improvementPotential = {
      appointmentBooked: 20,
      questionsCompleted: 15,
      responseTime: 10,
      conversationFlow: 10,
      customerEngagement: 8,
      painPointAddressed: 12
    };
    return improvementPotential[area] || 5;
  }

  async calculateLiveScore(conversationState) {
    // Calculate score for ongoing conversation
    let score = 50; // Base score
    
    if (conversationState.questionsCompleted > 3) score += 10;
    if (conversationState.smoothTransitions > 2) score += 10;
    if (conversationState.customerEngaged) score += 15;
    if (conversationState.painPointAcknowledged) score += 15;
    
    return Math.min(100, score);
  }

  async findRecoveryPatterns(conversationState) {
    // Find patterns where similar situations were recovered
    const query = `recovery from ${conversationState.currentIssue} in ${conversationState.phase}`;
    const results = await this.memoryService.retrieveRelevantMemories(null, query, 1);
    
    if (results.length > 0) {
      return {
        action: results[0].metadata.recovery_action,
        reasoning: results[0].metadata.recovery_reasoning,
        confidence: results[0].score
      };
    }
    
    return null;
  }

  async storeLearnedStrategies(strategies) {
    for (const strategy of strategies) {
      const content = `Learned strategy for ${strategy.area}: ${strategy.strategy}. Priority: ${strategy.priority}. Expected impact: ${strategy.expectedImpact}`;
      
      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `learned_strategy_${strategy.area}_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'learned_strategy',
          area: strategy.area,
          strategy: strategy.strategy,
          priority: strategy.priority,
          expected_impact: strategy.expectedImpact,
          timestamp: new Date().toISOString(),
          content: content
        }
      }]);
    }
  }
}

module.exports = SelfScoringLearningModule;
