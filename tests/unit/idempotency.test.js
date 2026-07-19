const { marshall } = require('@aws-sdk/util-dynamodb');

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  PutItemCommand: jest.fn(),
  GetItemCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
}));

const idempotency = require('../../src/utils/idempotency');

describe('idempotency', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  test('tryAcquireLock returns acquired=true on first attempt', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await idempotency.tryAcquireLock('test-key-123');

    expect(result.acquired).toBe(true);
  });

  test('tryAcquireLock returns existing response on duplicate', async () => {
    const existingResponse = { message: 'Seat hold acquired', seatId: 'Sec1#RowA#Seat1' };

    mockSend
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
      .mockResolvedValueOnce({
        Item: marshall({
          PK: 'IDEMP#existing-key',
          SK: 'IDEMP#existing-key',
          status: 'completed',
          response: JSON.stringify(existingResponse),
        }),
      });

    const result = await idempotency.tryAcquireLock('existing-key');

    expect(result.acquired).toBe(false);
    expect(result.status).toBe('completed');
    expect(JSON.parse(result.response)).toEqual(existingResponse);
  });

  test('tryAcquireLock throws on unexpected error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network failure'));

    await expect(idempotency.tryAcquireLock('test-key')).rejects.toThrow('Network failure');
  });

  test('complete marks idempotency record as completed', async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(idempotency.complete('test-key', { done: true })).resolves.not.toThrow();
  });

  test('fail marks idempotency record as failed', async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(idempotency.fail('test-key', { error: 'fail' })).resolves.not.toThrow();
  });
});
