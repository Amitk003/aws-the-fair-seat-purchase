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
  const sections = 20;
  const rows = 26;
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

async function seedTable(seats) {
  const chunks = chunkArray(seats, 25);
  let totalWritten = 0;

  for (const chunk of chunks) {
    const items = chunk.map((item) => ({
      PutRequest: {
        Item: marshall(item, { removeUndefinedValues: true }),
      },
    }));

    const command = new BatchWriteItemCommand({
      RequestItems: {
        [TABLE_NAME]: items,
      },
    });

    try {
      const response = await client.send(command);
      const unprocessed = response?.UnprocessedItems?.[TABLE_NAME]?.length || 0;
      totalWritten += chunk.length - unprocessed;

      if (unprocessed > 0) {
        console.warn(`Retrying ${unprocessed} unprocessed items...`);
      }
    } catch (err) {
      console.error('Batch write error:', err.message);
    }
  }

  return totalWritten;
}

async function main() {
  console.log('Generating 100,000 seat records...');
  const seats = generateSeats();
  console.log(`Generated ${seats.length} seats.`);

  console.log('Seeding DynamoDB table...');
  const written = await seedTable(seats);
  console.log(`Successfully wrote ${written} items to ${TABLE_NAME}.`);

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
