# Example of AWS Lambda and AWS Step Function

This repo contains the implementation of a "Fraud order check service" with and AWS lambda and AWS Step Function.  

The service is invoked by a "order created" event from the default bus. It makes a call to an external Fraud service that return a status, which has to be passed back to the default bus.  
The external provider cannot receive duplicate calls.

There are 2 subfolders which have been created as indipendent packages.

## Lambda

### Source code
It contains the handler which performs those tasks:
- validate event
- check in Dynamo if the order has already been checked for fraud
- call external provider
- store results in Dynamo
- put event to the default bus

### Stack
The stack provision:
- Dynamo Table
- Lambda
- Event bus rule that triggers the lambda
- Lambda policy


## Step Function

### Source code
It contains the handler that validates the event and transforms it in the Fraud Request for the provider

### Stack
The stack provision:
- Dynamo Table
- Lambda
- State Machine
- Event bus rule that triggers the state machine
- State Machine policy

The State Machine performs those tasks:
- invoke lambda that validates and transforms the event
- Dynamo GetItem
- Dynamo PutItem
- EventBridge PutEvent
- External API HTTP call

In addition, there are few Choices to handle the logic, Fail states to handle errors and Pass to transform data.

## Built with

- Typescript
- Node.js
- AWS CDK
