import { App } from "aws-cdk-lib";
import FraudStepFunctionStack from "./FraudStepFunctionStack";

const environment = {
  account: process.env.ACCOUNT,
  region: process.env.REGION,
};

const app = new App();
new FraudStepFunctionStack(app, "FraudStepFunctionStack", {
  env: environment,
});


