const mockSend = jest.fn();
jest.mock('../../src/utils/dynamodb', () => ({
  getClient: () => ({ send: mockSend }),
  getTableName: () => 'TicketingSystemOps',
}));

const handler = require('../../src/handlers/confirm-purchase').handler;

describe('confirm-purchase handler', () => {
  const validEvent = {
    fanId: 'FAN#user001',
    seatId: 'Sec1#RowA#Seat12',
    venueId: 'Wembley',
    transactionId: 'TX#abc-123',
    idempotencyKey: 'idemp-001',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns confirmed on successful transaction', async () => {
    mockSend.mockResolvedValue({});

    const result = await handler(validEvent);

    expect(result.status).toBe('confirmed');
    expect(result.transactionId).toBe('TX#abc-123');
    expect(result.seatId).toBe('Sec1#RowA#Seat12');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('returns failed when required fields are missing', async () => {
    const result = await handler({});

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Missing required fields');
  });

  test('returns failed on TransactionCanceledException', async () => {
    mockSend.mockRejectedValue({ name: 'TransactionCanceledException', message: 'Condition check failed' });

    const result = await handler(validEvent);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Transaction could not be completed');
  });

  test('throws on unexpected errors', async () => {
    mockSend.mockRejectedValue(new Error('Network error'));

    await expect(handler(validEvent)).rejects.toThrow('Network error');
  });
});
