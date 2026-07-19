const {
  SFNClient,
  StartExecutionCommand,
} = require('@aws-sdk/client-sfn');
const { getClient, getTableName } = require('../utils/dynamodb');
const { tryAcquireLock, complete, deleteLock } = require('../utils/idempotency');
const { buildScheduleName } = require('../utils/scheduler');

const ddbClient = getClient();
const TABLE_NAME = getTableName();
const stateMachineArn = process.env.STATE_MACHINE_ARN;

const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });

exports.handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event;
    const action = body.action || 'checkout';

    if (action === 'validateIdempotency') {
      return handleValidateIdempotency(body.idempotencyKey);
    }

    if (action === 'processPayment') {
      return handleProcessPayment(body);
    }

    if (action === 'refund') {
      return handleRefund(body);
    }

    const { seatId, fanId, idempotencyKey, venueId, paymentToken, amount } = body;

    if (!seatId || !fanId || !idempotencyKey || !paymentToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: seatId, fanId, idempotencyKey, paymentToken' }),
      };
    }

    return handleCheckout(seatId, fanId, idempotencyKey, venueId, paymentToken, amount);
  } catch (err) {
    console.error('Checkout error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Checkout processing failed' }),
    };
  }
};

async function handleValidateIdempotency(idempotencyKey) {
  const result = await tryAcquireLock(idempotencyKey);

  if (!result.acquired && result.status === 'completed') {
    return {
      isDuplicate: true,
      response: typeof result.response === 'string' ? JSON.parse(result.response) : result.response,
    };
  }

  return { isDuplicate: false };
}

async function handleProcessPayment(body) {
  const { fanId, seatId, amount, paymentToken } = body;

  if (!paymentToken || !amount) {
    return { status: 'failed', error: 'Missing payment details' };
  }

  const txId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  const paymentResult = {
    status: 'success',
    transactionId: txId,
    amount,
    processedAt: Math.floor(Date.now() / 1000),
  };

  console.log(`Payment processed: ${txId} for ${fanId} on ${seatId}, amount ${amount}`);

  return paymentResult;
}

async function handleRefund(body) {
  const { fanId, transactionId } = body;

  console.log(`Refund issued: transaction ${transactionId} for ${fanId}`);

  return { status: 'refunded', transactionId, refundedAt: Math.floor(Date.now() / 1000) };
}

async function handleCheckout(seatId, fanId, idempotencyKey, venueId, paymentToken, amount) {
  if (!stateMachineArn) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'State machine ARN not configured' }),
    };
  }

  const venue = venueId || 'Wembley';
  const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const scheduleName = buildScheduleName(seatId, fanId);

  const executionParams = {
    stateMachineArn,
    name: `checkout-${idempotencyKey}`,
    input: JSON.stringify({
      fanId,
      seatId,
      venueId: venue,
      transactionId: txId,
      idempotencyKey,
      paymentToken,
      amount: amount || 0,
      scheduleName,
    }),
  };

  try {
    const result = await sfnClient.send(new StartExecutionCommand(executionParams));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Checkout started',
        transactionId: txId,
        executionArn: result.executionArn,
      }),
    };
  } catch (err) {
    if (err.name === 'ExecutionAlreadyExists') {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'Checkout already in progress for this idempotency key' }),
      };
    }

    console.error('Failed to start checkout execution:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not start checkout process' }),
    };
  }
}
