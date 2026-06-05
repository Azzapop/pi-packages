/**
 * Amazon Bedrock Mantle provider for pi.
 *
 * Mantle is a Bedrock endpoint that serves OpenAI models (gpt-5.4, gpt-5.5, ...)
 * through the OpenAI Responses API rather than the Bedrock Converse / Invoke APIs.
 * Endpoint: https://bedrock-mantle.<region>.api.aws/openai/v1/responses
 *
 * Architecture:
 *   pi → streamSimpleOpenAIResponses → OpenAI SDK
 *      → http://127.0.0.1:<random>/openai/v1/...   (in-process SigV4 proxy)
 *      → https://bedrock-mantle.<region>.api.aws/openai/v1/...
 *
 * The proxy signs each outbound request with SigV4 (service "bedrock-mantle")
 * using the AWS default credential chain (AWS_PROFILE, env keys, SSO, web
 * identity, ECS task role, ...). When AWS_BEARER_TOKEN_BEDROCK or
 * BEDROCK_MANTLE_API_KEY is set, the bearer is used directly without signing.
 *
 * Model → region mapping mirrors the upstream PR (tasadurian/pi#1):
 *   openai.gpt-5.4 → us-west-2
 *   openai.gpt-5.5 → us-east-2
 * Override with AWS_REGION (or AWS_DEFAULT_REGION).
 */

import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";
import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	streamSimpleOpenAIResponses,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { Buffer } from "node:buffer";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";

const PROVIDER = "amazon-bedrock-mantle";
const API: Api = "bedrock-mantle-responses" as Api;
const SIGV4_SERVICE = "bedrock-mantle";

const DEFAULT_REGION_BY_MODEL: Record<string, string> = {
	"openai.gpt-5.4": "us-west-2",
	"openai.gpt-5.5": "us-east-2",
};

const MODELS: ProviderModelConfig[] = [
	{
		id: "openai.gpt-5.5",
		name: "OpenAI: GPT-5.5 (Bedrock Mantle)",
		api: API,
		baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
		reasoning: true,
		thinkingLevelMap: { off: null, xhigh: "xhigh" },
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 272000,
		maxTokens: 128000,
	},
	{
		id: "openai.gpt-5.4",
		name: "OpenAI: GPT-5.4 (Bedrock Mantle)",
		api: API,
		baseUrl: "https://bedrock-mantle.us-west-2.api.aws/openai/v1",
		reasoning: true,
		thinkingLevelMap: { off: null, xhigh: "xhigh" },
		input: ["text", "image"],
		cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
		contextWindow: 272000,
		maxTokens: 128000,
	},
];

// =============================================================================
// SigV4-signing in-process proxy
//
// Listens on 127.0.0.1:<random>. Incoming URL path begins with /openai/v1/...
// (set on the OpenAI client baseURL). We sign the request with SigV4 for
// bedrock-mantle.<region>.api.aws and stream the response back unchanged.
// =============================================================================

let proxyServer: Server | undefined;
let proxyPort: number | undefined;
let proxyStartPromise: Promise<number> | undefined;

const credentials = defaultProvider({});

function regionForRequest(req: IncomingMessage): string {
	const fromHeader = req.headers["x-pi-mantle-region"];
	if (typeof fromHeader === "string" && fromHeader) return fromHeader;
	return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

async function handleProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
	try {
		const region = regionForRequest(req);
		const upstreamHost = `bedrock-mantle.${region}.api.aws`;
		const path = req.url ?? "/";
		const body = await readBody(req);

		// Strip hop-by-hop and proxy-only headers before signing.
		const hopByHop = new Set([
			"host",
			"connection",
			"keep-alive",
			"transfer-encoding",
			"te",
			"trailer",
			"upgrade",
			"proxy-authorization",
			"proxy-connection",
			"x-pi-mantle-region",
		]);
		const inHeaders: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers)) {
			if (v === undefined) continue;
			if (hopByHop.has(k.toLowerCase())) continue;
			inHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
		}
		// AWS SDK strips Authorization while signing, but if a real bearer token
		// was passed in we want to use it instead of SigV4. Pi's OpenAI client
		// always sends "Authorization: Bearer <apiKey>"; treat our sentinel apiKey
		// values as "no bearer".
		const SENTINEL_BEARERS = new Set(["sigv4", "sigv4-placeholder", "<authenticated>"]);
		const rawAuth = inHeaders.authorization || inHeaders.Authorization;
		let bearerValue: string | undefined;
		if (typeof rawAuth === "string" && /^bearer\s+/i.test(rawAuth)) {
			const token = rawAuth.replace(/^bearer\s+/i, "").trim();
			if (token && !SENTINEL_BEARERS.has(token)) bearerValue = token;
		}
		const envBearer = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_MANTLE_API_KEY;
		if (!bearerValue && envBearer) bearerValue = envBearer;

		let outHeaders: Record<string, string>;
		if (bearerValue) {
			outHeaders = { ...inHeaders, host: upstreamHost, authorization: `Bearer ${bearerValue}` };
			delete outHeaders.Authorization;
		} else {
			delete inHeaders.authorization;
			delete inHeaders.Authorization;
			const signer = new SignatureV4({
				credentials,
				region,
				service: SIGV4_SERVICE,
				sha256: Sha256,
			});
			const url = new URL(`https://${upstreamHost}${path}`);
			// Only sign a minimal stable set of headers. The OpenAI client adds
			// many variable headers (x-stainless-*, accept-encoding, session_id,
			// x-client-request-id, ...) which Node may rewrite on the way out, and
			// signing those breaks the signature. We pass them through unsigned;
			// SigV4 only verifies headers listed in SignedHeaders.
			const unsignable = new Set<string>();
			for (const k of Object.keys(inHeaders)) {
				const lk = k.toLowerCase();
				if (
					lk === "content-type" ||
					lk === "x-amzn-mantle-client-agent" ||
					lk.startsWith("x-amz-")
				) {
					continue;
				}
				unsignable.add(lk);
			}
			const signed = await signer.sign(
				{
					method: req.method ?? "POST",
					protocol: "https:",
					hostname: upstreamHost,
					path: url.pathname,
					query: Object.fromEntries(url.searchParams.entries()),
					headers: { ...inHeaders, host: upstreamHost },
					body,
				},
				{ unsignableHeaders: unsignable },
			);
			outHeaders = signed.headers as Record<string, string>;
		}

		const upstream = httpsRequest(
			{
				host: upstreamHost,
				port: 443,
				method: req.method,
				path,
				headers: outHeaders,
			},
			(upstreamRes) => {
				res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
				upstreamRes.pipe(res);
			},
		);

		upstream.on("error", (err) => {
			if (!res.headersSent) {
				res.writeHead(502, { "content-type": "application/json" });
			}
			res.end(JSON.stringify({ error: { message: `Upstream error: ${err.message}` } }));
		});

		if (body.length > 0) upstream.write(body);
		upstream.end();

		req.on("close", () => upstream.destroy());
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (!res.headersSent) {
			res.writeHead(500, { "content-type": "application/json" });
		}
		res.end(JSON.stringify({ error: { message } }));
	}
}

function startProxy(): Promise<number> {
	if (proxyPort !== undefined) return Promise.resolve(proxyPort);
	if (proxyStartPromise) return proxyStartPromise;

	proxyStartPromise = new Promise<number>((resolve, reject) => {
		const server = createServer((req, res) => {
			handleProxy(req, res).catch(() => {
				if (!res.headersSent) res.writeHead(500);
				res.end();
			});
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as AddressInfo | null;
			if (!addr || typeof addr === "string") {
				reject(new Error("Failed to obtain proxy address"));
				return;
			}
			proxyServer = server;
			proxyPort = addr.port;
			// Reference-count: keep the event loop alive only while pi is running.
			server.unref();
			resolve(addr.port);
		});
	}).catch((err) => {
		proxyStartPromise = undefined;
		throw err;
	});

	return proxyStartPromise;
}

// =============================================================================
// streamSimple
// =============================================================================

function getBearerToken(options?: SimpleStreamOptions): string | undefined {
	// options.apiKey will be the literal "sigv4" sentinel set on the provider; the
	// real bearer (if any) comes from env vars. Treating any options.apiKey value
	// as bearer would also work, but keying off the env var is more predictable.
	const envBearer = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_MANTLE_API_KEY;
	if (envBearer) return envBearer;
	const opt = options?.apiKey;
	if (!opt || opt === "sigv4" || opt === "<authenticated>" || opt === "sigv4-placeholder") return undefined;
	return opt;
}

function regionForModel(model: Model<Api>): string {
	const env = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
	if (env) return env;
	const m = model.baseUrl.match(/^https?:\/\/bedrock-mantle\.([a-z0-9-]+)\.api\.aws/i);
	if (m) return m[1];
	return DEFAULT_REGION_BY_MODEL[model.id] ?? "us-east-1";
}

function streamBedrockMantle(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const region = regionForModel(model);
	const bearer = getBearerToken(options);
	const stream = createAssistantMessageEventStream();

	(async () => {
		try {
			const port = await startProxy();
			const proxyBaseUrl = `http://127.0.0.1:${port}/openai/v1`;
			const resolvedModel: Model<Api> = { ...model, baseUrl: proxyBaseUrl };

			const headers: Record<string, string> = {
				...(options?.headers ?? {}),
				"x-pi-mantle-region": region,
			};

			// streamSimpleOpenAIResponses requires an apiKey. In bearer mode pass it
			// through; in SigV4 mode pass a placeholder — the proxy strips the
			// Authorization header before signing.
			const apiKey = bearer ?? "sigv4-placeholder";

			const inner = streamSimpleOpenAIResponses(
				resolvedModel as unknown as Model<"openai-responses">,
				context,
				{ ...options, apiKey, headers },
			);

			for await (const event of inner) stream.push(event);
			stream.end();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			stream.push({
				type: "error",
				reason: "error",
				error: {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: message,
					timestamp: Date.now(),
				},
			});
			stream.end();
		}
	})();

	return stream;
}

// Suppress unused-import warning for httpRequest (we only use httpsRequest).
void httpRequest;
void proxyServer;

// =============================================================================
// Extension entry
// =============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER, {
		name: "Amazon Bedrock (Mantle)",
		baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
		// Always non-empty so pi's "is auth available?" gate passes. The real
		// auth (SigV4 with the default AWS credential chain, or a bearer token if
		// AWS_BEARER_TOKEN_BEDROCK / BEDROCK_MANTLE_API_KEY is set) is handled in
		// the streamSimple → SigV4 proxy below. The streamSimple treats this
		// sentinel value as "no bearer, use SigV4".
		apiKey: "sigv4",
		api: API,
		headers: {
			"x-amzn-mantle-client-agent": "pi",
		},
		models: MODELS,
		streamSimple: streamBedrockMantle,
	});
}
