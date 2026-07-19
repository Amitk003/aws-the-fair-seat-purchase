# The Fair Seat Purchase

A high-concurrency ticket booking system built on AWS serverless technologies. It can handle 100,000 seats and hundreds of thousands of concurrent users without overselling a single seat.

## Architecture Overview

The system uses an Ephemeral-Lease CQRS (Command Query Responsibility Segregation) approach:

- **Read path:** Users browse the seat map through a fast cache layer (Redis + CloudFront). The primary database is never hit by read requests.
- **Write path:** Seat holds and purchases go directly to DynamoDB using atomic conditional writes that prevent double-selling.
- **Eviction:** If a user leaves the checkout flow, the seat hold automatically expires after 8 minutes using EventBridge Scheduler.
- **Payment:** The checkout flow is orchestrated by AWS Step Functions with idempotency guarantees.

## Key Features

- No double-selling - guaranteed by DynamoDB conditional expressions
- 100,000 seat capacity with on-demand scaling
- Real-time seat availability via cached views
- Automatic hold expiration at exactly 8 minutes
- Exactly-once payment processing

## Tech Stack

- **Database:** Amazon DynamoDB (single-table design, on-demand capacity)
- **Compute:** AWS Lambda (Node.js)
- **Orchestration:** AWS Step Functions Express Workflows
- **Scheduling:** Amazon EventBridge Scheduler
- **Caching:** Amazon ElastiCache Redis + CloudFront/S3
- **Infrastructure:** AWS SAM (Serverless Application Model)

## Project Structure

```
the-fair-seat-purchase/
├── docs/                   # Documentation
├── src/
│   ├── handlers/           # Lambda function code
│   └── utils/              # Shared utilities (DDB client, idempotency, scheduler)
├── state-machines/         # Step Functions ASL definitions
├── tests/
│   ├── unit/               # Unit tests
│   ├── load/               # Load/performance tests (Artillery)
│   └── integration/        # Integration tests
├── tools/                  # CLI utilities (seed data, etc.)
├── template.yaml           # AWS SAM infrastructure definition
└── ROADMAP.md              # Implementation plan
```

## Getting Started

1. Clone the repo
2. Install dependencies: `npm install`
3. Run locally with LocalStack: `docker-compose up`
4. Deploy: `sam build && sam deploy --guided`

## Branches

Each feature is developed on its own branch. Branches are not merged automatically - the reviewer merges them manually after review.

- `seed-data` - Database schema and seed utility
- `infrastructure` - AWS SAM template and IAM setup
- `seat-hold` - Seat reservation and idempotency logic
- `eviction` - EventBridge Scheduler for hold expiration
- `checkout` - Step Functions checkout saga
- `cqrs-cache` - Real-time seat map caching
- `load-testing` - Performance and load tests
- `observability` - Monitoring, alerts, and CI/CD

## Setup

See [SETUP.md](SETUP.md) for local development and deployment instructions.
