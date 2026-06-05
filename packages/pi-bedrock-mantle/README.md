# pi-bedrock-mantle

Pi extension that registers **Amazon Bedrock Mantle** as a custom provider.

Mantle is a Bedrock endpoint that hosts OpenAI models (`openai.gpt-5.4`, `openai.gpt-5.5`, ...) behind the OpenAI Responses API rather than the Bedrock Converse / Invoke APIs. Reference: <https://code.claude.com/docs/en/amazon-bedrock#use-the-mantle-endpoint>.

## Models

| Model id | Default region |
|---|---|
| `openai.gpt-5.5` | `us-east-2` |
| `openai.gpt-5.4` | `us-west-2` |

Override the region with `AWS_REGION` (or `AWS_DEFAULT_REGION`); the hostname is rewritten to `bedrock-mantle.<region>.api.aws`.

## Auth

Two modes, auto-detected per request:

1. **Bearer token** — set `AWS_BEARER_TOKEN_BEDROCK` or `BEDROCK_MANTLE_API_KEY`. The extension delegates to pi-ai's OpenAI Responses streaming with the token in `Authorization: Bearer ...`.
2. **SigV4** (default) — uses the AWS default credential chain (`AWS_PROFILE`, env keys, SSO, web identity, ECS task role, ...). The SigV4 service name is `bedrock-mantle`.

Your AWS account must be allowlisted for the model. A 403 from Mantle means access has not been granted; contact your AWS team.

## Install

```bash
cd packages/pi-bedrock-mantle
npm install
```

Then register the package with pi:

```bash
# In ~/.pi/agent/settings.json under "packages":
"~/src/pi-packages/packages/pi-bedrock-mantle"
```

## Use

```bash
AWS_PROFILE=devops-account \
  pi --provider amazon-bedrock-mantle \
     --model openai.gpt-5.5 \
     --thinking medium \
     -p "say hi"
```

## Implementation notes

- Single extension at `extensions/bedrock-mantle.ts`. Calls `pi.registerProvider("amazon-bedrock-mantle", {...})`.
- For SigV4, the request body is built with pi-ai's exported `convertResponsesMessages` and `convertResponsesTools`, signed with `@smithy/signature-v4` + `@aws-sdk/credential-provider-node`, and the SSE response is fed back into pi-ai's `processResponsesStream`.
- For bearer mode, it just delegates to `streamSimpleOpenAIResponses` with a rewritten `baseUrl` and the bearer apiKey.
- Mirrors the in-progress upstream PR at <https://github.com/tasadurian/pi/pull/1>; once that lands in pi-ai, this extension can be removed.
