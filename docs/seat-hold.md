# Seat Hold and Idempotency

This document explains how seats are reserved and how duplicate requests are prevented.

## How Seat Hold Works

When a fan clicks on a seat to reserve it, the system does the following:

1. **Check for duplicates** - The system checks if this request has been seen before using the idempotency key. If yes, it returns the cached response without making any changes.

2. **Try to acquire the seat** - The system sends an UpdateItem command to DynamoDB with a condition expression. The write only succeeds if:
   - The seat status is "available", OR
   - The seat status is "held" but the hold has already expired

3. **Create eviction schedule** - If the hold is successful, an EventBridge schedule is created to auto-release the seat after 8 minutes.

4. **Return result** - The fan gets a success or failure response.

## Idempotency

Idempotency means that even if a fan clicks the "reserve" button multiple times, the seat will only be reserved once.

### How it works

- Every request from the client includes a unique idempotency key (a UUID).
- Before processing the request, the system tries to insert a record with that key into DynamoDB.
- If the insert succeeds, this is a new request. Process it normally.
- If the insert fails (key already exists), this is a duplicate. Return the cached response from the first attempt.

### Record states

| State | Meaning |
|-------|---------|
| in_progress | The request is being processed |
| completed | The request finished successfully |
| failed | The request failed |

### TTL cleanup

Idempotency records have a TTL of 24 hours. DynamoDB will automatically delete them after that time.

## API Endpoint

### POST /hold

Request body:
```json
{
  "seatId": "Sec1#RowA#Seat12",
  "fanId": "FAN#user001",
  "idempotencyKey": "uuid-123-abc",
  "venue": "Wembley"
}
```

Success response (200):
```json
{
  "message": "Seat hold acquired",
  "seatId": "Sec1#RowA#Seat12",
  "venueId": "Wembley",
  "holdExpiresAt": 1700000000
}
```

Seat taken response (409):
```json
{
  "error": "Seat is not available",
  "seatId": "Sec1#RowA#Seat12"
}
```

## Unit Tests

Run the tests with:
```
npm run test:unit
```

The tests cover:
- Missing required fields
- Successful seat hold
- Seat already held (conflict)
- Duplicate idempotency key
- Request in progress
- Unexpected errors
