async function sendWebhook(axios, bookingInfo, connectionData, discoveryData, sendSchedulingPreference) {
  return await sendSchedulingPreference(
    bookingInfo.name || connectionData.customerName || '',
    bookingInfo.email || connectionData.customerEmail || '',
    bookingInfo.phone || connectionData.customerPhone || '',
    bookingInfo.preferredDay || 'No preference',
    connectionData.callId,
    discoveryData
  );
}

module.exports = { sendWebhook };