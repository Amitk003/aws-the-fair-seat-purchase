const { PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getClient, getTableName } = require('./dynamodb');

const client = getClient();
const TABLE_NAME = getTableName();

function buildKey(idempotencyKey) {
  return marshall({
    PK: `IDEMP#${idempotencyKey}`,
    SK: `IDEMP#${idempotencyKey}`,
  });
}

async function tryAcquireLock(idempotencyKey) {
  try {
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        ...buildKey(idempotencyKey),
        ...marshall({
          status: 'in_progress',
          created_at: Math.floor(Date.now() / 1000),
          ttl: Math.floor(Date.now() / 1000) + 86400,
        }),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    return { acquired: true };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      const existing = await client.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: buildKey(idempotencyKey),
      }));
      if (!existing.Item) {
        return { acquired: false, error: 'Idempotency record not found after conflict' };
      }
      const record = unmarshall(existing.Item);
      return { acquired: false, status: record.status, response: record.response };
    }
    throw err;
  }
}

async function complete(idempotencyKey, responsePayload) {
  const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
  await client.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: buildKey(idempotencyKey),
    UpdateExpression: 'SET #status = :completed, #response = :response',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#response': 'response',
    },
    ExpressionAttributeValues: marshall({
      ':completed': 'completed',
      ':response': JSON.stringify(responsePayload),
    }),
  }));
}

async function fail(idempotencyKey, errorPayload) {
  const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
  await client.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: buildKey(idempotencyKey),
    UpdateExpression: 'SET #status = :failed, #response = :response',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#response': 'response',
    },
    ExpressionAttributeValues: marshall({
      ':failed': 'failed',
      ':response': JSON.stringify(errorPayload),
    }),
  }));
}

module.exports = { tryAcquireLock, complete, fail };
