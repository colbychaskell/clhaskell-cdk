import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import path = require("path");

export interface StaticWebsiteStackProps extends StackProps {
  /**
   * The subdomain for this environment (e.g., 'beta.example.com')
   */
  domainName: string;

  /**
   * The hosted zone ID in the DNS account
   */
  hostedZoneId: string;

  /**
   * The hosted zone name (root domain)
   */
  hostedZoneName: string;

  /**
   * ARN of the cross-account role in the DNS account
   */
  crossAccountRoleArn: string;

  /**
   * Stage name (e.g., 'beta' or 'gamma')
   */
  stageName: string;
}

export class StaticWebsiteStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: StaticWebsiteStackProps) {
    super(scope, id, props);

    // Create S3 bucket to store assets
    this.bucket = new s3.Bucket(this, `SiteBucket`, {
      bucketName: `${props.stageName}-website-${this.account}`,
      websiteIndexDocument: "index.html",
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Import the hosted zone from the DNS account
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.hostedZoneName,
      },
    );

    // Create certificate in us-east-1 for CloudFront
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Note: The certificate validation will use the cross-account role
    // automatically through the Route53 hosted zone reference

    // Create CloudFront Origin Access Identity
    const oai = new cf.OriginAccessIdentity(this, "OAI", {
      comment: `OAI for ${props.domainName}`,
    });

    // Grant cloudfront read access to the bucket
    this.bucket.grantRead(oai);

    // Create CloudFront distribution
    this.distribution = new cf.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: [props.domainName],
      certificate: certificate,
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: "/error.html",
        },
        {
          httpStatus: 403,
          responseHttpStatus: 403,
          responsePagePath: "/error.html",
        },
      ],
    });

    // Create subdomain NS record pointing to CloudFront
    // This uses cross-account delegation
    new route53.ARecord(this, "AliasRecord", {
      zone: hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution),
      ),
    });

    // Deploy from the build folder to the s3 bucket
    new s3deploy.BucketDeployment(this, "WebsiteDeployment", {
      sources: [
        s3deploy.Source.asset(
          path.resolve(__dirname, "../../../clhaskellelectric.com/dist"),
        ),
      ],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
    });

    // Outputs
    new CfnOutput(this, "BucketName", {
      value: this.bucket.bucketName,
      description: "S3 Bucket Name",
    });

    new CfnOutput(this, "DistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront Distribution ID",
    });

    new CfnOutput(this, "DistributionDomainName", {
      value: this.distribution.distributionDomainName,
      description: "CloudFront Distribution Domain Name",
    });

    new CfnOutput(this, "WebsiteUrl", {
      value: `https://${props.domainName}`,
      description: "Website URL",
    });
  }
}
