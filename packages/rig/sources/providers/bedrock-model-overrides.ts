export interface BedrockModelOverride {
    endpoint?: string;
    region?: string;
}

export type BedrockModelOverrides = Readonly<Record<string, BedrockModelOverride>>;
