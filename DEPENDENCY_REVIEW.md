# Dependency review

The locked source workspace was checked with pnpm audit before the initial source release.

| Severity | Findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Moderate | 7 |
| Low | 2 |

The release pins security overrides for tar 7.5.21, underscore 1.13.8 and legacy ws 5.2.7, in addition to the existing policy in pnpm-workspace.yaml. Those versions were verified in the npm registry. Unneeded automatic React Native peer installation is disabled for this browser/Node integration.

These results apply to the checked-in lockfile and workspace policy, not to the deployed application's dependency tree or a different consumer project. Remaining lower-severity advisories are not represented as resolved. This dependency review is not an independent security audit.

When installing the SDK tarball in another project, apply the relevant overrides from [the SDK workspace policy](https://github.com/sql-hq/railgun-sdk/blob/main/pnpm-workspace.yaml) at your application's root, regenerate its lockfile and audit that resulting tree. A dependency cannot enforce its own root-level overrides on a consumer.

Source release checks: application typecheck and production build passed; ten RPC gateway tests passed; nineteen SDK tests passed; compiled SDK root and engine imports passed. Controlled mainnet financial evidence is available in [sql-docs](https://github.com/sql-hq/sql-docs/tree/main/evidence). Comprehensive real external-wallet browser acceptance is not claimed.
