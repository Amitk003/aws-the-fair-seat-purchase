# Data Model

This document explains how data is stored in the DynamoDB table.

## Table: TicketingSystemOps

We use a single-table design. This means all types of data (seats, transactions, idempotency records) live in one table. The partition key (PK) and sort key (SK) are used to separate different types of data.

### Billing Mode

PAY_PER_REQUEST (on-demand). The table automatically scales up and down based on traffic.

### Primary Key

- Partition Key (PK): String
- Sort Key (SK): String

### Entity Types

#### Seat Inventory

Used to store each seat in the stadium.

| Attribute | Example | Description |
|-----------|---------|-------------|
| PK | VENUE#Wembley | Venue identifier |
| SK | SEAT#Sec1#RowA#Seat12 | Exact seat location |
| status | "available" | One of: available, held, sold |
| held_by | "FAN#abc123" | Fan holding the seat (null if available) |
| hold_expires_at | 1700000000 | Unix timestamp when hold expires (0 if available) |

Seat status flow:
- available -> held (when a fan reserves the seat)
- held -> sold (when payment is complete)
- held -> available (when hold expires without payment)

#### Transaction Receipt

Created after a successful purchase.

| Attribute | Example | Description |
|-----------|---------|-------------|
| PK | TX#987654321 | Transaction ID |
| SK | TX#987654321 | Same as PK |
| fan_id | "FAN#abc123" | Who bought the seat |
| seat_id | "Sec1#RowA#Seat12" | Which seat was bought |
| status | "confirmed" | Payment status |
| created_at | 1700000000 | When the purchase happened |

#### Idempotency Token

Used to prevent duplicate requests (like a user clicking "pay" twice).

| Attribute | Example | Description |
|-----------|---------|-------------|
| PK | IDEMP#abc-123 | Unique request ID from the client |
| SK | IDEMP#abc-123 | Same as PK |
| status | "completed" | One of: in_progress, completed |
| response | {...} | Cached response for the request |
| ttl | 1700000000 | Auto-expire old tokens (DynamoDB TTL) |

### Access Patterns

1. **Get a seat by venue and location**
   - Query on PK = VENUE#<venue> and SK = SEAT#<seat>

2. **Hold a seat (atomic update)**
   - UpdateItem with condition: status = available OR (status = held AND hold_expires_at < now)

3. **Complete a purchase**
   - TransactWriteItems: change seat to sold, create receipt, check idempotency

4. **Check for duplicate request**
   - PutItem with condition: attribute_not_exists(PK) on IDEMP# prefix

5. **Stream all seat changes**
   - DynamoDB Streams captures every state change for cache updates
