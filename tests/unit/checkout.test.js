const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

jest.mock('../../src/utils/dynamodb', () => ({
  getClient: () => ({ send: jest.fn() }),
  getTableName: () => 'TicketingSystemOps',
}));

const mockIdempotency = {
  tryAcquireLock: jest.fn(),
  complete: jest.fn(),
  deleteLock: jest.fn(),
};
jest.mock('../../src/utils/idempotency', () => mockIdempotency);

jest.mock('../../src/utils/scheduler', () => ({
  buildScheduleName: jest.fn(() => 'evict-Sec1-RowA-Seat12-FAN-user001'),
}));

const mockSfnSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn(),
  DescribeExecutionCommand: jest.fn(),
}));

const OLD_ENV = process.env;

describe('checkout handler', () => {
  let handler;

  beforeAll(() => {
    process.env = { ...OLD_ENV, STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:checkout-saga' };
    handler = require('../../src/handlers/checkout').handler;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 when required fields are missing', async () => {
    const event = { body: '{}' };
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Missing required fields');
  });

  test('starts execution and returns 200 on valid checkout', async () => {
    mockSfnSend.mockResolvedValue({ executionArn: 'arn:aws:states:us-east-1:123:execution:checkout-saga:exec-001' });

    const event = {
      body: JSON.stringify({
        seatId: 'Sec1#RowA#Seat12',
        fanId: 'FAN#user001',
        idempotencyKey: 'idemp-001',
        paymentToken: 'tok_visa',
        amount: 5000,
      }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Checkout started');
    expect(body.transactionId).toContain('tx_');
  });

  test('returns 409 when execution already exists', async () => {
    mockSfnSend.mockRejectedValue({ name: 'ExecutionAlreadyExists' });

    const event = {
      body: JSON.stringify({
        seatId: 'Sec1#RowA#Seat12',
        fanId: 'FAN#user001',
        idempotencyKey: 'idemp-001',
        paymentToken: 'tok_visa',
      }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(409);
  });

  test('handles validateIdempotency action', async () => {
    mockIdempotency.tryAcquireLock.mockResolvedValue({ acquired: true });

    const event = {
      body: JSON.stringify({
        idempotencyKey: 'idemp-001',
        action: 'validateIdempotency',
      }),
    };

    const result = await handler(event);

    expect(result.isDuplicate).toBe(false);
  });

  test('handles processPayment action', async () => {
    const event = {
      body: JSON.stringify({
        action: 'processPayment',
        fanId: 'FAN#user001',
        seatId: 'Sec1#RowA#Seat12',
        amount: 5000,
        paymentToken: 'tok_visa',
      }),
    };

    const result = await handler(event);

    expect(result.status).toBe('success');
    expect(result.transactionId).toContain('pay_');
  });

  test('handles refund action', async () => {
    const event = {
      body: JSON.stringify({
        action: 'refund',
        fanId: 'FAN#user001',
        transactionId: 'tx_123',
      }),
    };

    const result = await handler(event);

    expect(result.status).toBe('refunded');
  });

  test('returns 500 on unexpected error', async () => {
    mockSfnSend.mockRejectedValue(new Error('Network error'));

    const event = {
      body: JSON.stringify({
        seatId: 'Sec1#RowA#Seat12',
        fanId: 'FAN#user001',
        idempotencyKey: 'idemp-001',
        paymentToken: 'tok_visa',
      }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });

  test('handles releaseLock action', async () => {
    mockIdempotency.deleteLock.mockResolvedValue(undefined);

    const event = {
      body: JSON.stringify({
        action: 'releaseLock',
        idempotencyKey: 'idemp-001',
      }),
    };

    const result = await handler(event);

    expect(result.status).toBe('released');
    expect(mockIdempotency.deleteLock).toHaveBeenCalledWith('idemp-001');
  });
});
