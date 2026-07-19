const {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
} = require('@aws-sdk/client-scheduler');

const REGION = process.env.AWS_REGION || 'us-east-1';

let client;

function getClient() {
  if (!client) {
    client = new SchedulerClient({
      region: REGION,
      ...(process.env.LOCALSTACK_ENDPOINT && {
        endpoint: process.env.LOCALSTACK_ENDPOINT,
      }),
    });
  }
  return client;
}

function buildScheduleName(seatId, fanId) {
  const safeSeat = seatId.replace(/[#]/g, '-');
  const safeFan = fanId.replace(/[#]/g, '-');
  return `evict-${safeSeat}-${safeFan}`;
}

async function scheduleEviction(seatId, fanId, venueId, expiresAt) {
  const schedulerClient = getClient();
  const tableArn = process.env.TABLE_ARN;
  const tableName = process.env.TABLE_NAME;
  const schedulerRoleArn = process.env.SCHEDULER_ROLE_ARN;

  if (!tableArn || !tableName || !schedulerRoleArn) {
    throw new Error('Missing required env vars: TABLE_ARN, TABLE_NAME, SCHEDULER_ROLE_ARN');
  }

  const scheduleName = buildScheduleName(seatId, fanId);

  const scheduleDate = new Date(expiresAt * 1000);
  const isoString = scheduleDate.toISOString().replace(/\.\d{3}/, '');

  await schedulerClient.send(new CreateScheduleCommand({
    Name: scheduleName,
    ScheduleExpression: `at(${isoString})`,
    Target: {
      Arn: 'arn:aws:scheduler:::aws-sdk:dynamodb:updateItem',
      RoleArn: schedulerRoleArn,
      Input: JSON.stringify({
        TableName: tableName,
        Key: {
          PK: { S: `VENUE#${venueId}` },
          SK: { S: `SEAT#${seatId}` },
        },
        UpdateExpression: 'SET #status = :available REMOVE held_by, hold_expires_at',
        ConditionExpression: '#status = :held AND held_by = :fanId',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':available': { S: 'available' },
          ':held': { S: 'held' },
          ':fanId': { S: fanId },
        },
      }),
    },
    FlexibleTimeWindow: { Mode: 'OFF' },
    ActionAfterCompletion: 'DELETE',
  }));

  return scheduleName;
}

async function cancelEviction(seatId, fanId) {
  const schedulerClient = getClient();
  const scheduleName = buildScheduleName(seatId, fanId);

  try {
    await schedulerClient.send(new DeleteScheduleCommand({
      Name: scheduleName,
      ClientToken: `${scheduleName}-${Date.now()}`,
    }));
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      return;
    }
    throw err;
  }
}

async function getEvictionStatus(seatId, fanId) {
  const schedulerClient = getClient();
  const scheduleName = buildScheduleName(seatId, fanId);

  try {
    await schedulerClient.send(new GetScheduleCommand({
      Name: scheduleName,
    }));
    return { exists: true };
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      return { exists: false };
    }
    throw err;
  }
}

module.exports = { scheduleEviction, cancelEviction, getEvictionStatus, buildScheduleName };
