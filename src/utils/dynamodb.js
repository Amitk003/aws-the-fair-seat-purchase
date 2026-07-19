const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';

let client;

function getClient() {
  if (!client) {
    client = new DynamoDBClient({
      region: REGION,
      ...(process.env.LOCALSTACK_ENDPOINT && {
        endpoint: process.env.LOCALSTACK_ENDPOINT,
      }),
    });
  }
  return client;
}

function getTableName() {
  return process.env.TABLE_NAME || 'TicketingSystemOps';
}

module.exports = { getClient, getTableName };
