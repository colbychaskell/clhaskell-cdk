import { CfnOutput, Fn, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

export interface DnsStackProps extends StackProps {
  readonly domainName: string;
  readonly trustedAccountIds: string[];
}

export class DnsStack extends Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly crossAccountRole: iam.Role;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    this.hostedZone = new route53.PublicHostedZone(this, "RootHostedZone", {
      zoneName: props.domainName,
    });
    this.hostedZone.applyRemovalPolicy(
      RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    );

    // Create IAM role that staging accounts can assume
    this.crossAccountRole = new iam.Role(this, "CrossAccountDnsRole", {
      roleName: "CrossAccountDnsManagementRole",
      assumedBy: new iam.CompositePrincipal(
        ...props.trustedAccountIds.map(
          (accountId) => new iam.AccountPrincipal(accountId),
        ),
      ),
      description: "Role allowing cross-account DNS record management",
    });

    // Grant permissions to manage Route53 records in this hosted zone
    this.crossAccountRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "route53:ChangeResourceRecordSets",
          "route53:GetChange",
          "route53:ListResourceRecordSets",
        ],
        resources: [
          this.hostedZone.hostedZoneArn,
          "arn:aws:route53:::change/*",
        ],
      }),
    );

    // Additional permissions for certificate validation
    this.crossAccountRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["route53:GetHostedZone", "route53:ListHostedZones"],
        resources: ["*"],
      }),
    );

    new CfnOutput(this, "HostedZoneId", {
      value: this.hostedZone.hostedZoneId,
      description: "Hosted Zone ID",
      exportName: `${this.stackName}-HostedZoneId`,
    });

    new CfnOutput(this, "HostedZoneName", {
      value: this.hostedZone.zoneName,
      description: "Hosted Zone Name",
      exportName: `${this.stackName}-HostedZoneName`,
    });

    new CfnOutput(this, "CrossAccountRoleArn", {
      value: this.crossAccountRole.roleArn,
      description: "ARN of the cross-account DNS management role",
      exportName: `${this.stackName}-CrossAccountRoleArn`,
    });

    new CfnOutput(this, "NameServers", {
      value: Fn.join(", ", this.hostedZone.hostedZoneNameServers || []),
      description: "Name servers for the hosted zone",
    });
  }
}
