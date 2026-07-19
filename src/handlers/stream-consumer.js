const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLE_NAME = process.env.TABLE_NAME || 'TicketingSystemOps';
const SEAT_MAP_BUCKET = process.env.SEAT_MAP_BUCKET || 'seat-map-cache';

const SECTION_SHARD_COUNT = 10;

exports.handler = async (event) => {
  const batchFailures = [];
  const sectionChanges = {};

  for (const record of event.Records) {
    try {
      if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY' && record.eventName !== 'REMOVE') {
        continue;
      }

      const newImage = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : null;
      const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : null;

      if (!newImage && !oldImage) continue;

      const item = newImage || oldImage;
      const pk = item.PK || '';
      const sk = item.SK || '';

      if (!pk.startsWith('VENUE#') || !sk.startsWith('SEAT#')) continue;

      const venueId = pk.replace('VENUE#', '');
      const sectionId = extractSection(sk);

      if (!sectionId) continue;

      if (!sectionChanges[venueId]) {
        sectionChanges[venueId] = {};
      }
      if (!sectionChanges[venueId][sectionId]) {
        sectionChanges[venueId][sectionId] = { available: 0, held: 0, sold: 0 };
      }

      const oldStatus = oldImage ? oldImage.status : null;
      const newStatus = newImage ? newImage.status : null;

      if (oldStatus && sectionChanges[venueId][sectionId][oldStatus] !== undefined) {
        sectionChanges[venueId][sectionId][oldStatus]--;
      }
      if (newStatus && sectionChanges[venueId][sectionId][newStatus] !== undefined) {
        sectionChanges[venueId][sectionId][newStatus]++;
      }
    } catch (err) {
      console.error('Error processing stream record:', err.message, JSON.stringify(record));
      batchFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
    }
  }

  try {
    await Promise.all(
      Object.entries(sectionChanges).flatMap(([venueId, sections]) =>
        Object.entries(sections).map(([sectionId, counts]) =>
          Promise.all([
            updateShardedCounter(venueId, sectionId, counts),
            uploadSectionCache(venueId, sectionId, counts),
          ])
        )
      )
    );
  } catch (err) {
    console.error('Failed to update caches:', err.message);
    const allSeqs = event.Records
      .filter(r => r.dynamodb && r.dynamodb.SequenceNumber)
      .map(r => r.dynamodb.SequenceNumber);
    for (const seq of allSeqs) {
      if (!batchFailures.find(f => f.itemIdentifier === seq)) {
        batchFailures.push({ itemIdentifier: seq });
      }
    }
  }

  return { batchItemFailures: batchFailures };
};

function extractSection(sk) {
  const parts = sk.replace('SEAT#', '').split('#');
  return parts.length > 0 ? parts[0] : null;
}

function hashShard(venueId, sectionId) {
  const hash = (venueId + '#' + sectionId).split('').reduce((acc, char) => {
    return acc + char.charCodeAt(0);
  }, 0);
  return (hash % SECTION_SHARD_COUNT) + 1;
}

async function updateShardedCounter(venueId, sectionId, counts) {
  const shard = hashShard(venueId, sectionId);
  const counterKey = marshall({
    PK: `VENUE#${venueId}`,
    SK: `COUNTER#${sectionId}#Shard${shard}`,
  });

  await ddbClient.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: counterKey,
    UpdateExpression: 'SET available = :available, held = :held, sold = :sold, updated_at = :updatedAt',
    ExpressionAttributeValues: marshall({
      ':available': counts.available,
      ':held': counts.held,
      ':sold': counts.sold,
      ':updatedAt': Math.floor(Date.now() / 1000),
    }),
  }));
}

async function uploadSectionCache(venueId, sectionId, counts) {
  const cacheKey = `venue/${venueId}/section/${sectionId}.json`;
  const cacheBody = JSON.stringify({
    venueId,
    sectionId,
    available: counts.available,
    held: counts.held,
    sold: counts.sold,
    updatedAt: Math.floor(Date.now() / 1000),
  });

  await s3Client.send(new PutObjectCommand({
    Bucket: SEAT_MAP_BUCKET,
    Key: cacheKey,
    Body: cacheBody,
    ContentType: 'application/json',
    CacheControl: 'max-age=5',
  }));
}
