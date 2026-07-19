# Infrastructure

This document explains the AWS infrastructure and how to deploy it.

## AWS SAM Template

The file `template.yaml` defines all the AWS resources using the Serverless Application Model (SAM). SAM is a tool that makes it easier to build and deploy serverless applications on AWS.

## Resources Created

### DynamoDB Table (TicketingSystemOps)

- Single table that stores seats, transactions, and idempotency tokens
- On-demand billing mode (pays per request, no need to provision capacity)
- Streams enabled to capture all data changes
- TTL enabled to auto-delete old idempotency tokens

### API Gateway (HTTP API)

- Two endpoints: POST /hold and POST /checkout
- Rate limiting: 5,000 burst, 10,000 requests per second
- Routes requests to Lambda functions

### Lambda Functions

| Function | Purpose |
|----------|---------|
| hold-seat | Reserves a seat for a fan |
| stream-consumer | Listens to DynamoDB stream and updates the cache |
| confirm-purchase | Marks a seat as sold inside the checkout flow |
| checkout | Starts the Step Functions checkout workflow |

### Step Functions (checkout-saga)

- Express workflow type (fast, high-throughput)
- Runs the payment flow: check idempotency -> process payment -> confirm seat
- All execution logs are sent to CloudWatch

### EventBridge Scheduler

- Creates one-time schedules to expire seat holds after 8 minutes
- Schedules auto-delete after they fire
- Directly calls DynamoDB (no Lambda in between)

### S3 Bucket (seat-map-cache)

- Stores the current seat availability as JSON files
- Publicly readable for distribution through CloudFront

## IAM Roles

Each Lambda function has its own IAM role with only the permissions it needs:

- **HoldSeatRole**: DynamoDB write, EventBridge Scheduler create/delete
- **StreamConsumerRole**: DynamoDB stream read, S3 write, SQS send
- **CheckoutSagaRole**: DynamoDB transactions, EventBridge delete, Lambda invoke
- **EventBridgeSchedulerExecutionRole**: DynamoDB update (for direct eviction)

## Local Development

### Using LocalStack

1. Start LocalStack:
   ```
   docker-compose up
   ```

2. Deploy locally:
   ```
   sam build && sam local start-api
   ```

3. Seed data:
   ```
   TABLE_NAME=TicketingSystemOps LOCALSTACK_ENDPOINT=http://localhost:4566 node tools/seed-stadium.js
   ```

### Prerequisites

- Node.js 20.x
- Docker Desktop
- AWS SAM CLI
- AWS credentials configured (for deployment)

## Deployment

Deploy to AWS:

```
sam build
sam deploy --guided
```

This will create the CloudFormation stack with all the resources.
