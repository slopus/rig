export function readBedrockBearerToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const token = env.AWS_BEARER_TOKEN_BEDROCK;
    return token !== undefined && token.trim().length > 0 ? token : undefined;
}
