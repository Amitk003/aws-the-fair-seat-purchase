const {
  DynamoDBClient,
  BatchWriteItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const TABLE_NAME = process.env.TABLE_NAME || 'TicketingSystemOps';
const VENUE = 'VENUE#Wembley';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.LOCALSTACK_ENDPOINT && {
    endpoint: process.env.LOCALSTACK_ENDPOINT,
  }),
});

function generateSeats() {
  const seats = [];
  const sections = 80;
  const rows = 25;
  const seatsPerRow = 50;

  for (let sec = 1; sec <= sections; sec++) {
    for (let row = 0; row < rows; row++) {
      const rowLetter = String.fromCharCode(65 + row);
      for (let seatNum = 1; seatNum <= seatsPerRow; seatNum++) {
        seats.push({
          PK: VENUE,
          SK: `SEAT#Sec${sec}#Row${rowLetter}#Seat${seatNum}`,
          status: 'available',
          held_by: null,
          hold_expires_at: 0,
        });
      }
    }
  }

  return seats;
}

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function writeBatchWithRetry(items, attempt = 1) {
  const command = new BatchWriteItemCommand({
    RequestItems: {
      [TABLE_NAME]: items,
    },
  });

  try {
    const response = await client.send(command);
    const unprocessed = response?.UnprocessedItems?.[TABLE_NAME];

    if (unprocessed && unprocessed.length > 0) {
      if (attempt > 5) {
        console.error(`[Attempt ${attempt}] Failed to write ${unprocessed.length} items. Max retries exceeded.`);
        return items.length - unprocessed.length;
      }
      const delay = Math.pow(2, attempt) * 25;
      await new Promise((resolve) => setTimeout(resolve, delay));
      const writtenInRetry = await writeBatchWithRetry(unprocessed, attempt + 1);
      return (items.length - unprocessed.length) + writtenInRetry;
    }
    return items.length;
  } catch (err) {
    console.error(`[Attempt ${attempt}] Batch write error:`, err.message);
    if (attempt > 5) return 0;
    const delay = Math.pow(2, attempt) * 25;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return writeBatchWithRetry(items, attempt + 1);
  }
}

async function seedTable(seats) {
  const chunks = chunkArray(seats, 25);
  const CONCURRENCY = 50;
  let totalWritten = 0;

  console.log(`Sending writes in concurrent batches of ${CONCURRENCY}...`);

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const promises = batch.map((chunk) => {
      const items = chunk.map((item) => ({
        PutRequest: {
          Item: marshall(item),
        },
      }));
      return writeBatchWithRetry(items);
    });

    const results = await Promise.all(promises);
    totalWritten += results.reduce((sum, val) => sum + val, 0);

    const progress = Math.min(100, ((i + batch.length) / chunks.length * 100).toFixed(1));
    console.log(`Progress: ${progress}% - Wrote ${totalWritten}/${seats.length} seats.`);
  }

  return totalWritten;
}

async function main() {
  // Basic sanity check
  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.LOCALSTACK_ENDPOINT) {
    console.warn('Warning: AWS_ACCESS_KEY_ID is not set. Ensure local credentials exist.');
  }

  console.log('Generating 100,000 seat records...');
  const seats = generateSeats();
  console.log(`Generated ${seats.length} seats.`);

  console.log('Seeding DynamoDB table...');
  const start = Date.now();
  const written = await seedTable(seats);
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`Successfully wrote ${written} items to ${TABLE_NAME} in ${duration}s.`);

  if (written === seats.length) {
    console.log('Seeding complete. All seats are available.');
  } else {
    console.warn(
      `Warning: Only ${written} of ${seats.length} seats were written.`
    );
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
