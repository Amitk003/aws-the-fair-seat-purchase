const { marshall } = require('@aws-sdk/util-dynamodb');

const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDdbSend })),
  UpdateItemCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn(),
}));

const handler = require('../../src/handlers/stream-consumer').handler;

function buildStreamRecord(eventName, oldStatus, newStatus, sk) {
  const record = {
    eventName,
    dynamodb: {
      SequenceNumber: '12345',
    },
  };

  if (newStatus) {
    record.dynamodb.NewImage = marshall(
      {
        PK: 'VENUE#Wembley',
        SK: sk || 'SEAT#Sec1#RowA#Seat12',
        status: newStatus,
        held_by: newStatus === 'available' ? null : 'FAN#user001',
        hold_expires_at: newStatus === 'available' ? 0 : Math.floor(Date.now() / 1000) + 480,
      },
      { removeUndefinedValues: true }
    );
  }

  if (oldStatus) {
    record.dynamodb.OldImage = marshall(
      {
        PK: 'VENUE#Wembley',
        SK: sk || 'SEAT#Sec1#RowA#Seat12',
        status: oldStatus,
        held_by: oldStatus === 'available' ? null : 'FAN#user001',
        hold_expires_at: oldStatus === 'available' ? 0 : Math.floor(Date.now() / 1000) + 480,
      },
      { removeUndefinedValues: true }
    );
  }

  return record;
}

describe('stream-consumer handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({});
  });

  test('processes a MODIFY event from available to held', async () => {
    const event = {
      Records: [buildStreamRecord('MODIFY', 'available', 'held')],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  test('processes a MODIFY event from held to sold', async () => {
    const event = {
      Records: [buildStreamRecord('MODIFY', 'held', 'sold')],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  test('processes a REMOVE event', async () => {
    const event = {
      Records: [buildStreamRecord('REMOVE', 'held', null)],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
  });

  test('skips non-seat records', async () => {
    const event = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            SequenceNumber: '12345',
            NewImage: marshall({
              PK: 'IDEMP#abc-123',
              SK: 'IDEMP#abc-123',
              status: 'completed',
            }),
          },
        },
      ],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test('handles multiple records in one batch', async () => {
    const event = {
      Records: [
        buildStreamRecord('MODIFY', 'available', 'held', 'SEAT#Sec1#RowA#Seat1'),
        buildStreamRecord('MODIFY', 'available', 'held', 'SEAT#Sec1#RowA#Seat2'),
        buildStreamRecord('MODIFY', 'available', 'sold', 'SEAT#Sec2#RowB#Seat10'),
      ],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
  });

  test('reports batch failure for errored records', async () => {
    mockDdbSend.mockRejectedValueOnce(new Error('DynamoDB failure'));
    const event = {
      Records: [buildStreamRecord('MODIFY', 'available', 'held')],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('12345');
  });

  test('processes INSERT event', async () => {
    const event = {
      Records: [buildStreamRecord('INSERT', null, 'available')],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
  });
});
