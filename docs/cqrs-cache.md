# Real-Time Seat Map Cache (CQRS)

This document explains how seat availability data flows from DynamoDB to the fast cache layer.

## The Problem

If every fan's browser directly queried DynamoDB for the seat map, the database would be overwhelmed by read traffic. DynamoDB would throttle requests and fans would see slow loading times.

## Solution: CQRS with DynamoDB Streams

CQRS (Command Query Responsibility Segregation) means we separate the write path (reserving seats) from the read path (browsing seats).

### Data Flow

1. A fan reserves a seat through the hold-seat API. This writes to DynamoDB.
2. DynamoDB Streams captures the state change.
3. The stream-consumer Lambda function processes the change.
4. It updates two things:
   - A sharded counter in DynamoDB for per-section availability
   - A JSON file in S3 for the seat map cache
5. The fan's browser reads from S3/CloudFront, never from DynamoDB.

## Stream Consumer Lambda

The file `src/handlers/stream-consumer.js` processes DynamoDB Stream events in batches.

### What it does for each record

1. Checks if the record is a seat record (starts with VENUE#/SEAT#).
2. Compares the old and new status to calculate the change.
3. Groups changes by venue and section.
4. After processing all records in the batch, updates the caches.

## Sharded Counters

To avoid DynamoDB hot-key problems, per-section counters are spread across multiple shards.

### How sharding works

- Each section has 10 shards (controlled by `SECTION_SHARD_COUNT`).
- The shard number is determined by hashing the venue and section ID.
- Write requests are spread across 10 different partition keys.

### Cache files in S3

The stream consumer uploads JSON files to S3 with this structure:

```
venue/Wembley/section/Sec1.json
venue/Wembley/section/Sec2.json
```

Each file contains:
```json
{
  "venueId": "Wembley",
  "sectionId": "Sec1",
  "available": 2500,
  "held": 5,
  "sold": 495,
  "updatedAt": 1700000000
}
```

## Serving the cache

The S3 bucket is configured to be publicly readable. For production, you should put CloudFront in front of it for global distribution and lower latency.

### Cache duration

Files are uploaded with `Cache-Control: max-age=5` (5 seconds). This means browsers can cache the data for 5 seconds before checking for updates. This reduces load while keeping the map reasonably current.

## Error Handling

- If processing a record fails, its sequence number is added to the `batchItemFailures` list. Lambda will retry that record.
- If cache updates fail, the error is logged but the batch is still marked as processed (the stream position moves forward). This prevents the Lambda from getting stuck on bad data.
