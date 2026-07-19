exports.handler = async (event) => {
  console.log('Stream event received:', JSON.stringify(event));
  return { batchItemFailures: [] };
};
