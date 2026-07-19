const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getClient, getTableName } = require('../utils/dynamodb');
const { tryAcquireLock, complete, deleteLock } = require('../utils/idempotency');
const { scheduleEviction } = require('../utils/scheduler');

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
        const responseObj = typeof idempotentResult.response === 'string'
          ? JSON.parse(idempotentResult.response)
          : idempotentResult.response;
        return {
          statusCode: responseObj.error ? 409 : 200,
          body: JSON.stringify(responseObj),
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
        seat: unmarshall(result.Attributes),
      };

      try {
        await scheduleEviction(seatId, fanId, venueId, expiresAt);
      } catch (schedulerErr) {
        console.error('Failed to create eviction schedule, rolling back seat hold:', schedulerErr.message);
        try {
          await client.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: marshall({ PK: `VENUE#${venueId}`, SK: `SEAT#${seatId}` }),
            UpdateExpression: 'SET #status = :available REMOVE held_by, hold_expires_at',
            ConditionExpression: '#status = :held AND held_by = :fanId',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({
              ':available': 'available',
              ':held': 'held',
              ':fanId': fanId,
            }),
          }));
        } catch (rollbackErr) {
          console.error('Critical: Failed to rollback seat hold after scheduler failure:', rollbackErr.message);
        }
        throw new Error(`Failed to schedule hold eviction: ${schedulerErr.message}`);
      }

      await complete(idempotencyKey, responsePayload);

      return {
        statusCode: 200,
        body: JSON.stringify(responsePayload),
      };
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        const responsePayload = { error: 'Seat is not available', seatId };
        await complete(idempotencyKey, responsePayload);
        return {
          statusCode: 409,
          body: JSON.stringify(responsePayload),
        };
      }

      await deleteLock(idempotencyKey);
      throw err;
    }
  } catch (err) {
    console.error('Hold seat error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not process hold request' }),
    };
  }
};
