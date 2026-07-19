# Automatic Hold Eviction

This document explains how expired seat holds are automatically returned to the available pool.

## The Problem

When a fan reserves a seat but does not complete the purchase within 8 minutes, the hold must be released so other fans can buy it. The system cannot rely on the fan to explicitly cancel the hold.

## Solution: EventBridge Scheduler

The system uses Amazon EventBridge Scheduler to create a one-time schedule for each seat hold. The schedule fires exactly 8 minutes after the hold was created.

### How it works

1. When a fan successfully reserves a seat, the system calls `scheduleEviction()`.
2. This creates a one-time EventBridge schedule set to fire at `hold_creation_time + 8 minutes`.
3. When the schedule fires, it directly calls the DynamoDB UpdateItem API (no Lambda needed).
4. The update changes the seat status back to "available" and removes the fan's hold.
5. After the schedule fires, it automatically deletes itself.

### Conditional update on eviction

The eviction update has a condition expression to make sure it only reverts seats that:
- Still have status "held"
- Are still held by the same fan who originally reserved them

This prevents the eviction from accidentally reverting a seat that was sold or re-reserved by a different fan.

### Schedule auto-cleanup

The schedule uses `ActionAfterCompletion: DELETE`. This means the schedule resource is automatically deleted after it fires. This keeps the AWS account clean and avoids reaching quota limits.

## Cancelling an Eviction

When a fan completes a purchase, the `cancelEviction()` function is called to delete the eviction schedule. This is part of the checkout flow on the checkout branch.

If the schedule already fired (fan took too long), `cancelEviction()` silently ignores the `ResourceNotFoundException` and continues.

## Grace period

The hold duration is set to 480 seconds (8 minutes). This is controlled by the `HOLD_DURATION_SECONDS` constant in the hold-seat handler.

## API quota consideration

EventBridge Scheduler has a default quota of 1,000 CreateSchedule calls per second per region. If you expect more than 1,000 holds per second, request a quota increase from AWS Support.

## Scheduler Utility Functions

| Function | Purpose |
|----------|---------|
| `scheduleEviction(seatId, fanId, venueId, expiresAt)` | Creates the 8-minute eviction schedule |
| `cancelEviction(seatId, fanId)` | Deletes the eviction schedule (used on successful purchase) |
| `getEvictionStatus(seatId, fanId)` | Checks if a schedule still exists |
