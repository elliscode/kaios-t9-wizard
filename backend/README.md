# setup

1. create a lambda (Python 3.14 runtime)
2. set the following environment variables on the lambda:
   - `APP_NAME` — app identifier, used in logging
   - `DOMAIN_NAMES` — comma-separated list of allowed CORS origins
   - `DYNAMODB_TABLE_NAME` — name of the DynamoDB table this backend reads/writes
3. run the `sh dev-release.sh` (or `sh prod-release.sh`) script
4. set up an API gateway with an ANY method with proxy integration and set your lambda as the target of the lambda integration

# releasing

run `sh dev-release.sh` for the dev lambda, or `sh prod-release.sh` for prod.

# endpoints

- `POST /api/ping` — health check, returns "pong"
- `POST /api/start` — issues a random seed + game ID for a new run (stub)
- `POST /api/submit` — accepts a finished run's replay data for scoring (stub)
- `GET /api/leaderboard` — returns the top 100 scores (stub)
