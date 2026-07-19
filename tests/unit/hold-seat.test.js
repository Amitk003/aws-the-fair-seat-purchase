const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const mockSend = jest.fn();
jest.mock('../../src/utils/dynamodb', () => ({
  getClient: () => ({ send: mockSend }),
  getTableName: () => 'TicketingSystemOps',
}));

const mockIdempotency = {
  tryAcquireLock: jest.fn(),
  complete: jest.fn(),
  fail: jest.fn(),
  deleteLock: jest.fn(),
};
jest.mock('../../src/utils/idempotency', () => mockIdempotency);

const mockScheduler = {
  scheduleEviction: jest.fn(),
  cancelEviction: jest.fn(),
  getEvictionStatus: jest.fn(),
};
jest.mock('../../src/utils/scheduler', () => mockScheduler);

const handler = require('../../src/handlers/hold-seat').handler;

describe('hold-seat handler', () => {
  const validEvent = {
    body: JSON.stringify({
      seatId: 'Sec1#RowA#Seat12',
      fanId: 'FAN#user001',
      idempotencyKey: 'uuid-123',
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 when required fields are missing', async () => {
    const event = { body: JSON.stringify({ seatId: 'abc' }) };
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Missing required fields');
  });

  test('returns 200 and acquires hold when seat is available', async () => {
    mockIdempotency.tryAcquireLock.mockResolvedValue({ acquired: true });
    mockIdempotency.complete.mockResolvedValue(undefined);
    mockScheduler.scheduleEviction.mockResolvedValue('evict-Sec1-RowA-Seat12-FAN-user001');
    mockSend.mockResolvedValue({
      Attributes: marshall({
        PK: 'VENUE#Wembley',
        SK: 'SEAT#Sec1#RowA#Seat12',
        status: 'held',
        held_by: 'FAN#user001',
        hold_expires_at: Math.floor(Date.now() / 1000) + 480,
      }),
    });

    const result = await handler(validEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Seat hold acquired');
    expect(body.seatId).toBe('Sec1#RowA#Seat12');
    expect(body.seat).toEqual({
      PK: 'VENUE#Wembley',
      SK: 'SEAT#Sec1#RowA#Seat12',
      status: 'held',
      held_by: 'FAN#user001',
      hold_expires_at: expect.any(Number),
    });
    expect(mockIdempotency.complete).toHaveBeenCalledWith('uuid-123', expect.any(Object));
  });

  test('returns 409 when seat is already held by another user', async () => {
    mockIdempotency.tryAcquireLock.mockResolvedValue({ acquired: true });
    mockSend.mockRejectedValue({ name: 'ConditionalCheckFailedException' });

    const result = await handler(validEvent);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Seat is not available');
    expect(mockIdempotency.complete).toHaveBeenCalledWith('uuid-123', {
      error: 'Seat is not available',
      seatId: 'Sec1#RowA#Seat12',
    });
  });

  test('returns cached response for duplicate idempotency key', async () => {
    mockIdempotency.tryAcquireLock.mockResolvedValue({
      acquired: false,
      status: 'completed',
      response: JSON.stringify({ message: 'Seat hold acquired', seatId: 'Sec1#RowA#Seat12' }),
    });

    const result = await handler(validEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Seat hold acquired');
  });

  test('returns 409 when request is already in progress', async () => {
    mockIdempotency.tryAcquireLock.mockResolvedValue({
      acquired: false,
      status: 'in_progress',
    });

    const result = await handler(validEvent);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Request already in progress');
  });

  test('returns 500 on unexpected error and releases lock', async () => {
    mockIdempotency.tryAcquireLock.mockResolvedValue({ acquired: true });
    mockSend.mockRejectedValue(new Error('Network error'));

    const result = await handler(validEvent);

    expect(result.statusCode).toBe(500);
    expect(mockIdempotency.deleteLock).toHaveBeenCalledWith('uuid-123');
  });

  test('returns 500 and rolls back hold when scheduling eviction fails', async () => {
    mockIdempotency.tryAcquireLock.mockResolvedValue({ acquired: true });
    mockScheduler.scheduleEviction.mockRejectedValue(new Error('Scheduler rate limit exceeded'));
    
    // First call: UpdateItem for seat hold succeeds
    mockSend.mockResolvedValueOnce({
      Attributes: marshall({
        PK: 'VENUE#Wembley',
        SK: 'SEAT#Sec1#RowA#Seat12',
        status: 'held',
        held_by: 'FAN#user001',
        hold_expires_at: Math.floor(Date.now() / 1000) + 480,
      }),
    });
    // Second call: UpdateItem for rollback succeeds
    mockSend.mockResolvedValueOnce({});

    const result = await handler(validEvent);

    expect(result.statusCode).toBe(500);
    // Verify seat hold UpdateItem and rollback UpdateItem were called
    expect(mockSend).toHaveBeenCalledTimes(2);
    // Verify idempotency lock was released
    expect(mockIdempotency.deleteLock).toHaveBeenCalledWith('uuid-123');
  });
});
