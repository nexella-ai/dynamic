function initDiscoveryState() {
  return {
    currentQuestionIndex: 0,
    questionsCompleted: 0,
    allQuestionsCompleted: false,
    lastBotMessage: '',
    waitingForAnswer: false,
    questionOrder: []
  };
}

module.exports = { initDiscoveryState };