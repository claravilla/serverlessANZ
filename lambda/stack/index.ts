import { App } from "aws-cdk-lib";
import FraudLambdaStack from "./FraudLambdaStack";

const environment = {
  account: process.env.ACCOUNT,
  region: process.env.REGION,
};

const app = new App();
new FraudLambdaStack(app, "FraudLambdaStack", {
  env: environment,
});


