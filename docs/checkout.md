# Checkout Flow

This document explains how the checkout process works after a fan reserves a seat.

## Overview

The checkout process uses AWS Step Functions Express Workflows to coordinate the purchase. The workflow runs these steps in order:

1. Validate Idempotency
2. Process Payment
3. Cancel Eviction Schedule
4. Confirm Purchase
5. Success or Refund

## Step Functions State Machine

The file `state-machines/checkout-saga.asl.json` defines the workflow. It is an Express workflow type for fast execution.

### States

| State | What it does |
|-------|-------------|
| ValidateIdempotency | Checks if this request was already processed. If yes, returns the cached response. |
| ChargeCreditCard | Calls the payment processor (simulated). If it fails, goes to PaymentFailed. |
| CancelEvictionSchedule | Deletes the 8-minute eviction schedule from EventBridge so the seat is not auto-released. |
| ConfirmPurchase | Runs a DynamoDB TransactWriteItems to mark the seat as sold and create a receipt. |
| CompensatePayment | If ConfirmPurchase fails, issues a refund to the fan. |

### Fault tolerance

- The ConfirmPurchase step uses TransactWriteItems with three operations in one atomic transaction:
  1. **ConditionCheck**: Makes sure the idempotency key is still valid.
  2. **Update**: Changes the seat from "held" to "sold", but only if it is still held by this fan.
  3. **Put**: Creates the transaction receipt record.
- If any of these operations fail, the entire transaction is rolled back.
- If ConfirmPurchase fails, the CompensatePayment state issues a refund.

## API Endpoint

### POST /checkout

Request body:
```json
{
  "seatId": "Sec1#RowA#Seat12",
  "fanId": "FAN#user001",
  "idempotencyKey": "uuid-123-abc",
  "paymentToken": "tok_visa",
  "amount": 5000,
  "venueId": "Wembley"
}
```

Success response (200):
```json
{
  "message": "Checkout started",
  "transactionId": "tx_1700000000_abc123",
  "executionArn": "arn:aws:states:..."
}
```

## Handlers

### checkout.js

The main API handler. It starts the Step Functions execution and also handles internal actions called by the state machine:

- `validateIdempotency`: Checks if the request was already processed.
- `processPayment`: Simulates a credit card charge. Returns success or failure.
- `refund`: Simulates a refund when the purchase confirmation fails.

### confirm-purchase.js

Called by the Step Function to atomically mark the seat as sold. It uses DynamoDB TransactWriteItems to:

1. Verify the idempotency key is in progress.
2. Change the seat status from "held" to "sold" (with a condition check).
3. Create the transaction receipt.
