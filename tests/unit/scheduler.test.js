const { CreateScheduleCommand, DeleteScheduleCommand, GetScheduleCommand } = require('@aws-sdk/client-scheduler');

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn(() => ({ send: mockSend })),
  CreateScheduleCommand: jest.fn(),
  DeleteScheduleCommand: jest.fn(),
  GetScheduleCommand: jest.fn(),
}));

const scheduler = require('../../src/utils/scheduler');

const OLD_ENV = process.env;

describe('scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...OLD_ENV,
      TABLE_ARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/TicketingSystemOps',
      TABLE_NAME: 'TicketingSystemOps',
      SCHEDULER_ROLE_ARN: 'arn:aws:iam::123456789012:role/EventBridgeSchedulerExecutionRole',
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('buildScheduleName replaces # with -', () => {
    const name = scheduler.buildScheduleName('Sec1#RowA#Seat12', 'FAN#user001');
    expect(name).toBe('evict-Sec1-RowA-Seat12-FAN-user001');
  });

  test('scheduleEviction creates a schedule with the correct parameters', async () => {
    mockSend.mockResolvedValue({});

    const expiresAt = Math.floor(Date.now() / 1000) + 480;
    const name = await scheduler.scheduleEviction('Sec1#RowA#Seat12', 'FAN#user001', 'Wembley', expiresAt);

    expect(name).toContain('evict-');
    expect(CreateScheduleCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: expect.objectContaining({
          Arn: process.env.TABLE_ARN,
          RoleArn: process.env.SCHEDULER_ROLE_ARN,
        }),
      })
    );
  });

  test('scheduleEviction throws when env vars are missing', async () => {
    delete process.env.TABLE_ARN;

    await expect(
      scheduler.scheduleEviction('Seat1', 'Fan1', 'Wembley', 1700000000)
    ).rejects.toThrow('Missing required env vars');
  });

  test('cancelEviction deletes the schedule', async () => {
    mockSend.mockResolvedValue({});

    await scheduler.cancelEviction('Sec1#RowA#Seat12', 'FAN#user001');

    expect(DeleteScheduleCommand).toHaveBeenCalled();
  });

  test('cancelEviction does not throw on ResourceNotFoundException', async () => {
    mockSend.mockRejectedValue({ name: 'ResourceNotFoundException' });

    await expect(
      scheduler.cancelEviction('Sec1#RowA#Seat12', 'FAN#user001')
    ).resolves.not.toThrow();
  });

  test('cancelEviction throws on unexpected errors', async () => {
    mockSend.mockRejectedValue(new Error('Network error'));

    await expect(
      scheduler.cancelEviction('Sec1#RowA#Seat12', 'FAN#user001')
    ).rejects.toThrow('Network error');
  });

  test('getEvictionStatus returns exists=true when schedule found', async () => {
    mockSend.mockResolvedValue({});

    const result = await scheduler.getEvictionStatus('Sec1#RowA#Seat12', 'FAN#user001');

    expect(result.exists).toBe(true);
  });

  test('getEvictionStatus returns exists=false when schedule not found', async () => {
    mockSend.mockRejectedValue({ name: 'ResourceNotFoundException' });

    const result = await scheduler.getEvictionStatus('Sec1#RowA#Seat12', 'FAN#user001');

    expect(result.exists).toBe(false);
  });
});
