# Load Testing

This directory contains Artillery-based load tests for the ticket booking system.

## Prerequisites

- Deploy the stack to AWS (or run locally with SAM)
- Set the API URL environment variable
- Ensure the DynamoDB table has seat data (run `npm run seed`)

## Running Tests

### 1. Hold endpoint load test

Tests the POST /hold endpoint under increasing concurrency:

```bash
$env:API_URL="https://abc123.execute-api.us-east-1.amazonaws.com/prod"
artillery run tests/load/hold-only.yml
```

### 2. Full checkout flow load test

Tests the complete hold + checkout flow under load:

```bash
$env:API_URL="https://abc123.execute-api.us-east-1.amazonaws.com/prod"
artillery run tests/load/full-checkout.yml
```

### 3. Using npm scripts

```bash
$env:API_URL="https://abc123.execute-api.us-east-1.amazonaws.com/prod"
npm run test:load
```

### Test Phases

| Phase | Duration | Arrival Rate | Description |
|-------|----------|-------------|-------------|
| Warm up | 30s | 5-20 req/s | Ramp up to establish baseline |
| Ramp | 60s | 20-100 req/s | Increase pressure gradually |
| Peak | 30s | 100-200 req/s | Simulate flash sale traffic |
| Sustain | 30s | 200 req/s | Hold peak load |

### Scenarios

**Hold Only** (`hold-only.yml`)
- Each virtual user picks a random seat from the CSV payload
- Sends a POST /hold request with unique fanId and idempotencyKey
- Expects 200 (acquired), 409 (conflict/duplicate), or 500 (error)

**Full Checkout** (`full-checkout.yml`)
- Each virtual user holds a seat first
- Waits 1 second (simulating user decision time)
- Sends a POST /checkout request to purchase the held seat

## Test Data

The `seats.csv` file contains 15 sample seats across 2 sections. In production, replace with real exported seat data from the DynamoDB table.

To export real seat IDs:
```bash
aws dynamodb scan \
  --table-name TicketingSystemOps \
  --filter-expression "begins_with(SK, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"SEAT#"}}' \
  --query "Items[*].[SK,PK]" \
  --output text
```

## Performance Budgets

The config enforces these thresholds (fail if exceeded):
- P95 response time < 2000ms
- P99 response time < 5000ms
- 409 conflict rate < 30% (expected under high contention)
- 500 error rate = 0%
