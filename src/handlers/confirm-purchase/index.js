const { TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { getClient, getTableName } = require('../../utils/dynamodb');

const client = getClient();
const TABLE_NAME = getTableName();

exports.handler = async (event) => {
  try {
    const { fanId, seatId, venueId, transactionId, idempotencyKey } = event;

    if (!fanId || !seatId || !transactionId || !idempotencyKey) {
      return {
        status: 'failed',
        error: 'Missing required fields: fanId, seatId, transactionId, idempotencyKey',
      };
    }

    const venue = venueId || 'Wembley';
    const now = Math.floor(Date.now() / 1000);

    await client.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `IDEMP#${idempotencyKey}`, SK: `IDEMP#${idempotencyKey}` }),
            UpdateExpression: 'SET #status = :completed, #response = :response',
            ConditionExpression: 'attribute_exists(PK) AND #status = :inProgress',
            ExpressionAttributeNames: { '#status': 'status', '#response': 'response' },
            ExpressionAttributeValues: marshall({
              ':completed': 'completed',
              ':inProgress': 'in_progress',
              ':response': JSON.stringify({
                status: 'confirmed',
                transactionId,
                seatId,
                venueId: venue,
                confirmedAt: now,
              }),
            }),
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `VENUE#${venue}`, SK: `SEAT#${seatId}` }),
            UpdateExpression: 'SET #status = :sold, sold_to = :fanId, sold_at = :soldAt',
            ConditionExpression: '#status = :held AND held_by = :fanId AND hold_expires_at > :now',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({
              ':sold': 'sold',
              ':fanId': fanId,
              ':soldAt': now,
              ':held': 'held',
              ':now': now,
            }),
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: marshall({
              PK: `TX#${transactionId}`,
              SK: `TX#${transactionId}`,
              fan_id: fanId,
              seat_id: seatId,
              status: 'confirmed',
              created_at: now,
            }),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    }));

    return {
      status: 'confirmed',
      transactionId,
      seatId,
      venueId: venue,
      confirmedAt: now,
    };
  } catch (err) {
    console.error('Confirm purchase error:', err.message);

    if (err.name === 'TransactionCanceledException') {
      return {
        status: 'failed',
        error: 'Transaction could not be completed. Seat may no longer be held or idempotency key is invalid.',
        details: err.message,
      };
    }

    throw err;
  }
};
