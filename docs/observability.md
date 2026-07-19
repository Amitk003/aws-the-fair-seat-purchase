# Observability

This document defines CloudWatch dashboards, alarms, and log queries for monitoring the system.

## CloudWatch Dashboard

Import the following JSON into CloudWatch to create a dashboard:

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "API Gateway - Latency P50/P95/P99",
        "metrics": [
          [ "AWS/ApiGateway", "Latency", { "stat": "p50" } ],
          [ "...", { "stat": "p95" } ],
          [ "...", { "stat": "p99" } ]
        ],
        "region": "us-east-1",
        "period": 60,
        "stat": "Average"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "API Gateway - 4XX / 5XX Errors",
        "metrics": [
          [ "AWS/ApiGateway", "4XXError", { "label": "4XX" } ],
          [ "AWS/ApiGateway", "5XXError", { "label": "5XX" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "DynamoDB - Throttled Requests",
        "metrics": [
          [ "AWS/DynamoDB", "ThrottledRequests", { "label": "Throttled" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "DynamoDB - ConditionalCheckFailedRequests",
        "metrics": [
          [ "AWS/DynamoDB", "ConditionalCheckFailedRequests", { "label": "Conflicts" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "DynamoDB - Consumed Write Capacity",
        "metrics": [
          [ "AWS/DynamoDB", "ConsumedWriteCapacityUnits", { "label": "WCU" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "DynamoDB Streams - Iterator Age",
        "metrics": [
          [ "AWS/DynamoDB", "IteratorAgeMilliseconds", { "label": "IteratorAge" } ]
        ],
        "region": "us-east-1",
        "period": 60,
        "yAxis": { "left": { "label": "ms" } }
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Lambda - Invocations and Errors",
        "metrics": [
          [ "AWS/Lambda", "Invocations", { "label": "Invocations", "stat": "Sum" } ],
          [ "AWS/Lambda", "Errors", { "label": "Errors", "stat": "Sum" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Lambda - Duration P50/P99",
        "metrics": [
          [ "AWS/Lambda", "Duration", { "label": "P50", "stat": "p50" } ],
          [ "AWS/Lambda", "Duration", { "label": "P99", "stat": "p99" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "EventBridge - Schedule Count",
        "metrics": [
          [ "AWS/Scheduler", "ScheduleCount", { "label": "Schedules" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Step Functions - Executions",
        "metrics": [
          [ "AWS/States", "ExecutionsStarted", { "label": "Started", "stat": "Sum" } ],
          [ "AWS/States", "ExecutionsFailed", { "label": "Failed", "stat": "Sum" } ],
          [ "AWS/States", "ExecutionTime", { "label": "Duration", "stat": "Average" } ]
        ],
        "region": "us-east-1",
        "period": 60
      }
    }
  ]
}
```

## CloudWatch Alarms

### DynamoDB Throttling Alarm

Triggers when any requests are throttled (indicates hot-key issue).

```yaml
TicketingThrottleAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: Ticketing-DynamoDB-Throttled
    AlarmDescription: DynamoDB requests are being throttled
    Namespace: AWS/DynamoDB
    MetricName: ThrottledRequests
    Statistic: Sum
    Period: 60
    EvaluationPeriods: 1
    Threshold: 0
    ComparisonOperator: GreaterThanThreshold
    TreatMissingData: notBreaching
    AlarmActions:
      - !Ref AlarmTopic
```

### Stream Iterator Age Alarm

Triggers when the stream consumer falls behind by more than 5 seconds.

```yaml
StreamIteratorAgeAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: Ticketing-Stream-IteratorAge
    AlarmDescription: DynamoDB Stream consumer is falling behind
    Namespace: AWS/DynamoDB
    MetricName: IteratorAgeMilliseconds
    Statistic: Maximum
    Period: 60
    EvaluationPeriods: 2
    Threshold: 5000
    ComparisonOperator: GreaterThanThreshold
    TreatMissingData: notBreaching
    AlarmActions:
      - !Ref AlarmTopic
```

### Schedule Count Alarm

Triggers when EventBridge schedules approach the regional quota (10k is a warning).

```yaml
ScheduleCountAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: Ticketing-ScheduleCount-High
    AlarmDescription: EventBridge schedule count approaching regional quota
    Namespace: AWS/Scheduler
    MetricName: ScheduleCount
    Statistic: Maximum
    Period: 300
    EvaluationPeriods: 1
    Threshold: 10000
    ComparisonOperator: GreaterThanThreshold
    TreatMissingData: notBreaching
    AlarmActions:
      - !Ref AlarmTopic
```

### SNS Topic for Alarms

Add to `template.yaml`:

```yaml
AlarmTopic:
  Type: AWS::SNS::Topic
  Properties:
    TopicName: Ticketing-Alarms
    Subscription:
      - Protocol: email
        Endpoint: # add your email here
```

## Key Log Queries

### Seat hold failures (non-conflict)

```
filter @message like /Hold seat error/
| fields @timestamp, @message
| sort @timestamp desc
| limit 50
```

### Eviction schedule failures

```
filter @message like /Failed to create eviction schedule/
| fields @timestamp, @message
| sort @timestamp desc
| limit 50
```

### Cache update failures

```
filter @message like /Failed to update caches/
| fields @timestamp, @message
| sort @timestamp desc
| limit 50
```

## Performance Budgets

| Metric | Threshold |
|--------|-----------|
| P95 latency (hold) | < 2000ms |
| P99 latency (hold) | < 5000ms |
| 5XX error rate | 0% |
| 409 conflict rate | < 30% under peak |
| Stream iterator age | < 5000ms |
| Schedule count | < 10000 |
