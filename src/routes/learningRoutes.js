// src/routes/learningRoutes.js
const express = require('express');
const router = express.Router();
const SelfScoringLearningModule = require('../services/learning/SelfScoringLearningModule');
const RAGMemoryService = require('../services/memory/RAGMemoryService');

// Initialize services
let learningModule = null;
let memoryService = null;

try {
  learningModule = new SelfScoringLearningModule();
  memoryService = new RAGMemoryService();
} catch (error) {
  console.error('❌ Failed to initialize learning services:', error);
}

/**
 * Get learning system health and stats
 */
router.get('/health', async (req, res) => {
  try {
    if (!learningModule) {
      return res.status(503).json({
        status: 'unavailable',
        error: 'Learning module not initialized'
      });
    }

    const memoryStats = await memoryService.getMemoryStats();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        learningModule: !!learningModule,
        memoryService: !!memoryService
      },
      memoryStats: memoryStats
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Get learning insights and performance metrics
 */
router.get('/insights', async (req, res) => {
  try {
    const { timeframe = '7d', limit = 100 } = req.query;
    
    // Learn from recent history
    const learningResults = await learningModule.learnFromHistory(parseInt(limit));
    
    res.json({
      success: true,
      timeframe,
      insights: learningResults.insights,
      strategies: learningResults.strategies,
      callsAnalyzed: learningResults.callsAnalyzed,
      recommendations: generateRecommendations(learningResults)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get call scores for a specific time period
 */
router.get('/scores', async (req, res) => {
  try {
    const { startDate, endDate, minScore, maxScore } = req.query;
    
    // Build filter
    const filter = {
      memory_type: { $eq: 'call_scoring' }
    };
    
    if (minScore) {
      filter.final_score = { $gte: parseInt(minScore) };
    }
    
    // Query scores
    const scores = await memoryService.index.query({
      vector: new Array(3072).fill(0),
      filter: filter,
      topK: 100,
      includeMetadata: true
    });
    
    // Process and format results
    const formattedScores = scores.matches?.map(match => ({
      callId: match.metadata.call_id,
      score: match.metadata.final_score,
      timestamp: match.metadata.timestamp,
      appointmentBooked: match.metadata.appointment_booked,
      strengths: JSON.parse(match.metadata.strengths || '[]'),
      improvements: JSON.parse(match.metadata.improvements || '[]')
    })) || [];
    
    // Calculate statistics
    const stats = calculateScoreStats(formattedScores);
    
    res.json({
      success: true,
      scores: formattedScores,
      statistics: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get successful patterns
 */
router.get('/patterns/successful', async (req, res) => {
  try {
    const { industry, painPoint, phase, limit = 10 } = req.query;
    
    // Build filter
    const filter = {
      memory_type: { $eq: 'success_pattern' }
    };
    
    if (industry) filter.industry = { $eq: industry };
    if (painPoint) filter.pain_point = { $eq: painPoint };
    if (phase) filter.pattern_type = { $eq: phase };
    
    // Query patterns
    const patterns = await memoryService.index.query({
      vector: new Array(3072).fill(0),
      filter: filter,
      topK: parseInt(limit),
      includeMetadata: true
    });
    
    // Format results
    const formattedPatterns = patterns.matches?.map(match => ({
      type: match.metadata.pattern_type,
      industry: match.metadata.industry,
      painPoint: match.metadata.pain_point,
      pattern: JSON.parse(match.metadata.pattern_data || '{}'),
      recommendation: match.metadata.recommendation,
      score: match.metadata.score,
      sourceCall: match.metadata.source_call
    })) || [];
    
    res.json({
      success: true,
      patterns: formattedPatterns,
      total: formattedPatterns.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get failure patterns to avoid
 */
router.get('/patterns/failures', async (req, res) => {
  try {
    const { phase, limit = 10 } = req.query;
    
    // Build filter
    const filter = {
      memory_type: { $eq: 'failure_pattern' }
    };
    
    if (phase) filter.phase = { $eq: phase };
    
    // Query patterns
    const patterns = await memoryService.index.query({
      vector: new Array(3072).fill(0),
      filter: filter,
      topK: parseInt(limit),
      includeMetadata: true
    });
    
    // Format results
    const formattedPatterns = patterns.matches?.map(match => ({
      phase: match.metadata.phase,
      responseText: match.metadata.response_text,
      userMessage: match.metadata.user_message,
      industry: match.metadata.industry,
      timestamp: match.metadata.timestamp
    })) || [];
    
    res.json({
      success: true,
      failurePatterns: formattedPatterns,
      total: formattedPatterns.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get learning strategies
 */
router.get('/strategies', async (req, res) => {
  try {
    const { area } = req.query;
    
    // Build filter
    const filter = {
      memory_type: { $eq: 'learned_strategy' }
    };
    
    if (area) filter.area = { $eq: area };
    
    // Query strategies
    const strategies = await memoryService.index.query({
      vector: new Array(3072).fill(0),
      filter: filter,
      topK: 20,
      includeMetadata: true
    });
    
    // Format and group by area
    const groupedStrategies = {};
    strategies.matches?.forEach(match => {
      const area = match.metadata.area;
      if (!groupedStrategies[area]) {
        groupedStrategies[area] = [];
      }
      groupedStrategies[area].push({
        strategy: match.metadata.strategy,
        priority: match.metadata.priority,
        expectedImpact: match.metadata.expected_impact,
        timestamp: match.metadata.timestamp
      });
    });
    
    res.json({
      success: true,
      strategies: groupedStrategies,
      areas: Object.keys(groupedStrategies)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Trigger manual learning from recent calls
 */
router.post('/learn', async (req, res) => {
  try {
    const { callCount = 50 } = req.body;
    
    console.log(`🧠 Triggering manual learning from last ${callCount} calls...`);
    
    const learningResults = await learningModule.learnFromHistory(callCount);
    
    res.json({
      success: true,
      message: 'Learning process completed',
      results: learningResults
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Score a specific call manually
 */
router.post('/score-call', async (req, res) => {
  try {
    const callData = req.body;
    
    if (!callData.callId) {
      return res.status(400).json({
        success: false,
        error: 'callId is required'
      });
    }
    
    const scoringResult = await learningModule.scoreCall(callData);
    
    res.json({
      success: true,
      scoring: scoringResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get performance trends
 */
router.get('/trends', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    // Query scores over time
    const scores = await memoryService.index.query({
      vector: new Array(3072).fill(0),
      filter: {
        memory_type: { $eq: 'call_scoring' }
      },
      topK: 1000,
      includeMetadata: true
    });
    
    // Group by day and calculate trends
    const dailyScores = {};
    scores.matches?.forEach(match => {
      const date = new Date(match.metadata.timestamp).toISOString().split('T')[0];
      if (!dailyScores[date]) {
        dailyScores[date] = {
          scores: [],
          appointments: 0,
          totalCalls: 0
        };
      }
      dailyScores[date].scores.push(match.metadata.final_score);
      dailyScores[date].totalCalls++;
      if (match.metadata.appointment_booked) {
        dailyScores[date].appointments++;
      }
    });
    
    // Calculate daily averages
    const trends = Object.entries(dailyScores).map(([date, data]) => ({
      date,
      averageScore: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
      appointmentRate: (data.appointments / data.totalCalls) * 100,
      totalCalls: data.totalCalls
    })).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    res.json({
      success: true,
      trends,
      summary: calculateTrendSummary(trends)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get industry-specific insights
 */
router.get('/insights/industry/:industry', async (req, res) => {
  try {
    const { industry } = req.params;
    
    // Query industry-specific patterns
    const patterns = await memoryService.index.query({
      vector: new Array(3072).fill(0),
      filter: {
        memory_type: { $in: ['success_pattern', 'call_scoring'] },
        industry: { $eq: industry }
      },
      topK: 50,
      includeMetadata: true
    });
    
    // Analyze patterns
    const insights = analyzeIndustryPatterns(patterns.matches || [], industry);
    
    res.json({
      success: true,
      industry,
      insights
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Test optimal strategy for a scenario
 */
router.post('/test-strategy', async (req, res) => {
  try {
    const { customerProfile, currentPhase } = req.body;
    
    if (!customerProfile || !currentPhase) {
      return res.status(400).json({
        success: false,
        error: 'customerProfile and currentPhase are required'
      });
    }
    
    const strategy = await learningModule.getOptimalStrategy(customerProfile, currentPhase);
    
    res.json({
      success: true,
      strategy: strategy || { message: 'No specific strategy found, using defaults' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get conversation improvement suggestions
 */
router.get('/suggestions/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    
    // Query call scoring data
    const callScores = await memoryService.index.query({
      vector: new Array(3072).fill(0),
      filter: {
        memory_type: { $eq: 'call_scoring' },
        call_id: { $eq: callId }
      },
      topK: 1,
      includeMetadata: true
    });
    
    if (!callScores.matches || callScores.matches.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Call scoring data not found'
      });
    }
    
    const scoringData = callScores.matches[0].metadata;
    const improvements = JSON.parse(scoringData.improvements || '[]');
    const learningPoints = JSON.parse(scoringData.learning_points || '[]');
    
    // Generate specific suggestions
    const suggestions = generateCallSuggestions(improvements, learningPoints);
    
    res.json({
      success: true,
      callId,
      finalScore: scoringData.final_score,
      suggestions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Export learning data for analysis
 */
router.get('/export', async (req, res) => {
  try {
    const { format = 'json', type = 'all' } = req.query;
    
    const exportData = {
      exportDate: new Date().toISOString(),
      scores: [],
      patterns: [],
      strategies: []
    };
    
    // Export call scores
    if (type === 'all' || type === 'scores') {
      const scores = await memoryService.index.query({
        vector: new Array(3072).fill(0),
        filter: { memory_type: { $eq: 'call_scoring' } },
        topK: 1000,
        includeMetadata: true
      });
      
      exportData.scores = scores.matches?.map(m => ({
        callId: m.metadata.call_id,
        score: m.metadata.final_score,
        timestamp: m.metadata.timestamp,
        appointmentBooked: m.metadata.appointment_booked
      })) || [];
    }
    
    // Export patterns
    if (type === 'all' || type === 'patterns') {
      const patterns = await memoryService.index.query({
        vector: new Array(3072).fill(0),
        filter: { memory_type: { $eq: 'success_pattern' } },
        topK: 500,
        includeMetadata: true
      });
      
      exportData.patterns = patterns.matches?.map(m => ({
        type: m.metadata.pattern_type,
        industry: m.metadata.industry,
        score: m.metadata.score,
        recommendation: m.metadata.recommendation
      })) || [];
    }
    
    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(exportData);
      res.header('Content-Type', 'text/csv');
      res.attachment('learning-export.csv');
      res.send(csv);
    } else {
      res.json(exportData);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper functions

function generateRecommendations(learningResults) {
  const recommendations = [];
  
  if (learningResults.insights.averageScore < 70) {
    recommendations.push({
      priority: 'high',
      area: 'overall_performance',
      recommendation: 'Focus on improving core conversation skills across all areas'
    });
  }
  
  if (learningResults.insights.successRate < 30) {
    recommendations.push({
      priority: 'high',
      area: 'appointment_booking',
      recommendation: 'Implement more effective closing techniques and urgency creation'
    });
  }
  
  // Add recommendations based on common weaknesses
  Object.entries(learningResults.insights.commonWeaknesses).forEach(([area, count]) => {
    if (count > 5) {
      recommendations.push({
        priority: 'medium',
        area: area,
        recommendation: `Address recurring weakness in ${area} - appears in ${count} calls`
      });
    }
  });
  
  return recommendations;
}

function calculateScoreStats(scores) {
  if (scores.length === 0) {
    return {
      average: 0,
      min: 0,
      max: 0,
      appointmentRate: 0
    };
  }
  
  const scoreValues = scores.map(s => s.score);
  const appointmentCount = scores.filter(s => s.appointmentBooked).length;
  
  return {
    average: scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length,
    min: Math.min(...scoreValues),
    max: Math.max(...scoreValues),
    appointmentRate: (appointmentCount / scores.length) * 100,
    totalCalls: scores.length,
    appointmentsBooked: appointmentCount
  };
}

function calculateTrendSummary(trends) {
  if (trends.length < 2) {
    return { improving: false, message: 'Not enough data for trends' };
  }
  
  const recent = trends.slice(-3);
  const previous = trends.slice(-6, -3);
  
  const recentAvg = recent.reduce((a, b) => a + b.averageScore, 0) / recent.length;
  const previousAvg = previous.reduce((a, b) => a + b.averageScore, 0) / previous.length;
  
  const improvement = ((recentAvg - previousAvg) / previousAvg) * 100;
  
  return {
    improving: improvement > 0,
    improvementPercentage: improvement.toFixed(1),
    recentAverageScore: recentAvg.toFixed(1),
    message: improvement > 0 
      ? `Performance improving by ${improvement.toFixed(1)}%`
      : `Performance declining by ${Math.abs(improvement).toFixed(1)}%`
  };
}

function analyzeIndustryPatterns(matches, industry) {
  const insights = {
    commonPainPoints: {},
    successfulApproaches: [],
    averageScore: 0,
    topPerformingStrategies: []
  };
  
  let totalScore = 0;
  let scoreCount = 0;
  
  matches.forEach(match => {
    // Count pain points
    if (match.metadata.pain_point) {
      insights.commonPainPoints[match.metadata.pain_point] = 
        (insights.commonPainPoints[match.metadata.pain_point] || 0) + 1;
    }
    
    // Collect successful approaches
    if (match.metadata.memory_type === 'success_pattern' && match.metadata.score >= 80) {
      insights.successfulApproaches.push({
        pattern: match.metadata.pattern_type,
        recommendation: match.metadata.recommendation,
        score: match.metadata.score
      });
    }
    
    // Calculate average score
    if (match.metadata.final_score) {
      totalScore += match.metadata.final_score;
      scoreCount++;
    }
  });
  
  insights.averageScore = scoreCount > 0 ? totalScore / scoreCount : 0;
  
  // Sort and limit results
  insights.topPerformingStrategies = insights.successfulApproaches
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  
  return insights;
}

function generateCallSuggestions(improvements, learningPoints) {
  const suggestions = [];
  
  improvements.forEach(improvement => {
    const suggestion = {
      area: improvement.area,
      priority: improvement.priority,
      specificActions: []
    };

    // Add this endpoint to your src/routes/learningRoutes.js file
// Place it after your existing endpoints but before module.exports

/**
 * Debug endpoint to check what's actually in the database
 */
router.get('/debug/all-scorings', async (req, res) => {
  try {
    if (!learningModule) {
      return res.status(503).json({
        success: false,
        error: 'Learning module not initialized'
      });
    }
    
    const results = await learningModule.debugGetAllRecentCalls();
    
    res.json({
      success: true,
      totalFound: results?.matches?.length || 0,
      samples: results?.matches?.slice(0, 10).map(m => ({
        callId: m.metadata.call_id,
        score: m.metadata.final_score,
        timestamp: m.metadata.timestamp,
        booked: m.metadata.appointment_booked,
        customerEmail: m.metadata.customer_email,
        strengths: m.metadata.strengths,
        improvements: m.metadata.improvements
      })),
      message: results ? 'Found call scorings' : 'No results found - check if calls are being scored properly'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

/**
 * Force a manual learning cycle
 */
router.post('/trigger-learning', async (req, res) => {
  try {
    if (!learningModule) {
      return res.status(503).json({
        success: false,
        error: 'Learning module not initialized'
      });
    }
    
    console.log('🚀 Manually triggering learning cycle...');
    
    const results = await learningModule.learnFromHistory(100);
    
    res.json({
      success: true,
      message: 'Learning cycle completed',
      results: {
        callsAnalyzed: results.callsAnalyzed,
        uniqueCalls: results.uniqueCalls,
        averageScore: results.insights?.averageScore?.toFixed(1),
        successRate: results.insights?.successRate?.toFixed(1),
        scoreDistribution: results.insights?.scoreDistribution,
        recentTrend: results.insights?.recentTrend,
        strategiesGenerated: results.strategies?.length || 0
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
    
    // Generate specific actions based on area
    switch (improvement.area) {
      case 'appointmentBooked':
        suggestion.specificActions = [
          'Offer specific time slots earlier in the conversation',
          'Create urgency by mentioning limited availability',
          'Ask for the appointment more directly'
        ];
        break;
      case 'questionsCompleted':
        suggestion.specificActions = [
          'Make discovery questions more conversational',
          'Use better transition phrases between questions',
          'Show more genuine interest in their answers'
        ];
        break;
      case 'responseTime':
        suggestion.specificActions = [
          'Optimize response generation for 2-3 second timing',
          'Pre-load common responses',
          'Reduce processing overhead'
        ];
        break;
      case 'conversationFlow':
        suggestion.specificActions = [
          'Use smoother transition phrases',
          'Avoid abrupt topic changes',
          'Follow a more natural conversation arc'
        ];
        break;
      case 'customerEngagement':
        suggestion.specificActions = [
          'Ask more open-ended questions',
          'Show enthusiasm in responses',
          'Mirror customer energy level'
        ];
        break;
      case 'painPointAddressed':
        suggestion.specificActions = [
          'Acknowledge pain points more explicitly',
          'Show empathy before presenting solutions',
          'Connect solutions directly to their specific challenges'
        ];
        break;
    }
    
    suggestions.push(suggestion);
  });
  
  return suggestions;
}

function convertToCSV(data) {
  let csv = '';
  
  // Export scores
  if (data.scores.length > 0) {
    csv += 'Call Scores\n';
    csv += 'Call ID,Score,Timestamp,Appointment Booked\n';
    data.scores.forEach(score => {
      csv += `${score.callId},${score.score},${score.timestamp},${score.appointmentBooked}\n`;
    });
    csv += '\n';
  }
  
  // Export patterns
  if (data.patterns.length > 0) {
    csv += 'Success Patterns\n';
    csv += 'Type,Industry,Score,Recommendation\n';
    data.patterns.forEach(pattern => {
      csv += `${pattern.type},${pattern.industry},${pattern.score},"${pattern.recommendation}"\n`;
    });
  }
  
  return csv;
}

module.exports = router;
