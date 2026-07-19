const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { getClient, getTableName } = require('../utils/dynamodb');
const { tryAcquireLock, complete } = require('../utils/idempotency');

const client = getClient();
const TABLE_NAME = getTableName();
const HOLD_DURATION_SECONDS = 480;

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { seatId, fanId, idempotencyKey, venue } = body;

    if (!seatId || !fanId || !idempotencyKey) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: seatId, fanId, idempotencyKey' }),
      };
    }

    const idempotentResult = await tryAcquireLock(idempotencyKey);
    if (!idempotentResult.acquired) {
      if (idempotentResult.status === 'completed') {
        return {
          statusCode: 200,
          body: typeof idempotentResult.response === 'string'
            ? idempotentResult.response
            : JSON.stringify(idempotentResult.response),
        };
      }
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'Request already in progress' }),
      };
    }

    const venueId = venue || 'Wembley';
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + HOLD_DURATION_SECONDS;

    try {
      const result = await client.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: `VENUE#${venueId}`, SK: `SEAT#${seatId}` }),
        UpdateExpression: 'SET #status = :held, held_by = :fanId, hold_expires_at = :expiresAt',
        ConditionExpression: '#status = :available OR (#status = :held AND :now > hold_expires_at)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: marshall({
          ':held': 'held',
          ':fanId': fanId,
          ':expiresAt': expiresAt,
          ':available': 'available',
          ':now': now,
        }),
        ReturnValues: 'ALL_NEW',
      }));

      const responsePayload = {
        message: 'Seat hold acquired',
        seatId,
        venueId,
        holdExpiresAt: expiresAt,
        seat: marshall(result.Attributes, { removeUndefinedValues: true }),
      };

      await complete(idempotencyKey, responsePayload);

      return {
        statusCode: 200,
        body: JSON.stringify(responsePayload),
      };
    } catch (err) {
      const { fail } = require('../utils/idempotency');
      await fail(idempotencyKey, { error: err.message });

      if (err.name === 'ConditionalCheckFailedException') {
        return {
          statusCode: 409,
          body: JSON.stringify({ error: 'Seat is not available', seatId }),
        };
      }

      throw err;
    }
  } catch (err) {
    console.error('Hold seat error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not process hold request' }),
    };
  }
exports.handler = async (event) => {
  return {
    statusCode: 501,
    body: JSON.stringify({ error: 'Not implemented' }),
  };
};
