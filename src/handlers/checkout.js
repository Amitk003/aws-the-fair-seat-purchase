exports.handler = async (event) => {
  return {
    statusCode: 501,
    body: JSON.stringify({ error: 'Not implemented' }),
  };
};
