import {
    modelAnthropicFable5,
    modelAnthropicOpus48,
    modelAnthropicSonnet5,
    modelOpenaiGpt56Luna,
    modelOpenaiGpt56Sol,
    modelOpenaiGpt56Terra,
} from "@slopus/rig-execution";
import type { Model } from "@slopus/rig-execution";

export interface BedrockModelRoute {
    model: Model;
    provider: "anthropic" | "openai";
    supportedRegions?: readonly string[];
}

const BEDROCK_COMMERCIAL_MODEL_REGIONS = [
    "af-south-1",
    "ap-east-2",
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-northeast-3",
    "ap-south-1",
    "ap-south-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-southeast-3",
    "ap-southeast-4",
    "ap-southeast-5",
    "ap-southeast-6",
    "ap-southeast-7",
    "ca-central-1",
    "ca-west-1",
    "eu-central-1",
    "eu-central-2",
    "eu-north-1",
    "eu-south-1",
    "eu-south-2",
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "il-central-1",
    "me-central-1",
    "me-south-1",
    "mx-central-1",
    "sa-east-1",
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
] as const;

export const BEDROCK_MODEL_ROUTES: readonly BedrockModelRoute[] = [
    {
        model: modelAnthropicSonnet5,
        provider: "anthropic",
        supportedRegions: BEDROCK_COMMERCIAL_MODEL_REGIONS,
    },
    {
        model: modelAnthropicFable5,
        provider: "anthropic",
        supportedRegions: BEDROCK_COMMERCIAL_MODEL_REGIONS,
    },
    {
        model: modelAnthropicOpus48,
        provider: "anthropic",
        supportedRegions: BEDROCK_COMMERCIAL_MODEL_REGIONS,
    },
    {
        model: bedrockModel(modelOpenaiGpt56Sol, true),
        provider: "openai",
        supportedRegions: ["us-east-1", "us-east-2"],
    },
    {
        model: bedrockModel(modelOpenaiGpt56Terra, true),
        provider: "openai",
        supportedRegions: ["us-east-1", "us-east-2", "us-west-2"],
    },
    {
        model: bedrockModel(modelOpenaiGpt56Luna, false),
        provider: "openai",
        supportedRegions: ["us-east-1", "us-east-2", "us-west-2"],
    },
];

function bedrockModel(model: Model, omitUltra: boolean): Model {
    return {
        ...model,
        contextWindow: 272_000,
        ...(omitUltra
            ? { thinkingLevels: model.thinkingLevels.filter((level) => level !== "ultra") }
            : {}),
    };
}
