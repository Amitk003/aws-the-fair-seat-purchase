# Setup Guide

## Prerequisites

- Node.js 20+
- AWS SAM CLI
- Docker Desktop (for local development with LocalStack)
- AWS account (for deployment)

## Installation

```bash
npm install
```

## Local Development with LocalStack

1. Start LocalStack:
   ```bash
   docker compose up -d
   ```

2. Verify LocalStack is running:
   ```bash
   curl http://localhost:4566/_localstack/health
   ```

3. Run unit tests:
   ```bash
   npm run test:unit
   ```

4. Seed the database with 100,000 seats:
   ```bash
   npm run seed
   ```

## Deploy to AWS

1. Build the SAM application:
   ```bash
   sam build
   ```

2. Deploy:
   ```bash
   sam deploy --guided
   ```

   Follow the prompts:
   - Stack name: `the-fair-seat-purchase`
   - AWS Region: `us-east-1`
   - Confirm capabilities: yes
   - Save configuration: yes

3. Note the API URL from the stack outputs:
   ```bash
   sam list stack-outputs --stack-name the-fair-seat-purchase
   ```

## Running Load Tests

Set the API URL and run:
```bash
$env:API_URL = "https://abc123.execute-api.us-east-1.amazonaws.com/prod"
npm run test:load
```

## Project Structure

```
src/
  handlers/
    hold-seat.js          Reserve a seat
    checkout.js           Start checkout flow
    confirm-purchase.js   Finalize purchase
    stream-consumer.js    Sync seat map cache
  utils/
    dynamodb.js           DynamoDB client helper
    idempotency.js        Idempotency guard
    scheduler.js          EventBridge Scheduler wrapper
tests/
  unit/                   Jest unit tests
  load/                   Artillery load tests
tools/
  seed-stadium.js         Seed 100,000 seats
state-machines/
  checkout-saga.asl.json  Step Functions definition
template.yaml             AWS SAM infrastructure
```
