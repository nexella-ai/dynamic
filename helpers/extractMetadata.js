function extractCallMetadata(callData) {
  return {
    customerEmail: callData?.email || callData?.customer_email || callData?.user_email || callData?.metadata?.customer_email || '',
    customerName: callData?.name || callData?.customer_name || callData?.user_name || callData?.metadata?.customer_name || '',
    customerPhone: callData?.phone || callData?.customer_phone || callData?.to_number || callData?.metadata?.customer_phone || ''
  };
}

module.exports = { extractCallMetadata };